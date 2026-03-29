import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  getConversation,
  getConversationSummary,
  getSettings,
  savePendingInteraction,
  clearPendingInteraction,
} from "../db/repository.js";
import { getProfile } from "../providers/index.js";
import { generateAssistantReply, generateEphemeralReply } from "../services/chat-service.js";
import {
  classifyIntent,
  getClassifierConfig,
  resolveClassifierModel,
} from "../classifier/intentClassifier.js";
import type { IntentResult } from "../classifier/intentClassifier.js";
import { getToolsForIntent } from "../skills/skillsConfig.js";
import { getToolDefinitions } from "../skills/skillRegistry.js";
import { conversationEvents } from "../services/conversation-events.js";
import { TitleService } from "../services/title-service.js";
import { createEphemeralSse, createSse } from "../utils/sse.js";
import { AGENT_TASK_SYSTEM_PROMPT, SCHEDULE_SYSTEM_PROMPT } from "../utils/constants.js";
import type { VisualizerWidget } from "../types.js";
import type { MemoryNoteRow } from "../memory/types.js";
import { getActiveNotes } from "../memory/memoryDb.js";

type ContentBlock =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "widget"; index: number };

const LOCAL_USER = "local_user";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const imageAttachmentSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  dataUrl: z.string().min(1),
});

const chatSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    truncateFromMessageId: z.string().uuid().optional(),
    content: z.string().default(""),
    images: z.array(imageAttachmentSchema).default([]),
    profileId: z.string().min(1).optional(),
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    workspacePath: z.string().nullable().optional(),
    conversationType: z.enum(["chat", "schedule"]).optional(),
  })
  .refine((data) => data.content.trim().length > 0 || data.images.length > 0, {
    message: "Message content or at least one image is required.",
    path: ["content"],
  });

const ephemeralChatSchema = z
  .object({
    content: z.string().default(""),
    images: z.array(imageAttachmentSchema).default([]),
    profileId: z.string().min(1).optional(),
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
          images: z.array(imageAttachmentSchema).optional(),
        })
      )
      .default([]),
  })
  .refine((data) => data.content.trim().length > 0 || data.images.length > 0, {
    message: "Message content or at least one image is required.",
    path: ["content"],
  });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatRoutesOptions {
  memory: {
    query(opts: { userId: string; chatId: string; currentMessage: string }): Promise<string>;
  };
  titleService: TitleService;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMemorySearchFn() {
  return function (query: string, limit = 5) {
    const notes = getActiveNotes(LOCAL_USER, 200);
    const queryLower = query.toLowerCase();

    const scored = notes.map((note: MemoryNoteRow) => {
      let score = note.salience * 0.3;

      if (note.summary.toLowerCase().includes(queryLower)) score += 0.5;

      const words = queryLower.split(/\s+/).filter((w) => w.length > 3);
      for (const w of words) {
        if (note.summary.toLowerCase().includes(w)) score += 0.05;
      }

      const days = (Date.now() - new Date(note.updated_at).getTime()) / 86_400_000;
      score += Math.exp(-days / 30) * 0.2;

      return { note, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ note }) => ({
        kind: note.kind,
        summary: note.summary,
        confidence: note.confidence,
        scope: note.scope,
        entities: [] as string[],
      }));
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function chatRoutes(app: FastifyInstance, opts: ChatRoutesOptions): Promise<void> {
  const { memory, titleService } = opts;

  app.post("/api/chat", async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const sse = createSse(reply);

    // ── Clear any pending interaction — user is now responding ───────────────
    if (parsed.data.conversationId) {
      clearPendingInteraction(parsed.data.conversationId);
    }

    // ── Detect schedule mode ─────────────────────────────────────────────────
    let isScheduleConversation = parsed.data.conversationType === "schedule";
    if (!isScheduleConversation && parsed.data.conversationId) {
      const existingConv = getConversation(parsed.data.conversationId);
      if (existingConv?.conversationType === "schedule") {
        isScheduleConversation = true;
      }
    }

    // ── Intent classification ────────────────────────────────────────────────
    const classifierConfig = getClassifierConfig();
    let classifierResult: IntentResult = { intent: "chat", confidence: 0 };
    let classifierReasoningText: string | undefined;

    if (classifierConfig.enabled) {
      const classifierStart = Date.now();
      try {
        const settings = getSettings();
        const profile = getProfile(settings, parsed.data.profileId);
        const chatModel = parsed.data.model?.trim() ?? "";
        const classifierModel = resolveClassifierModel(
          profile.classifierModel?.trim() || chatModel
        );

        if (classifierModel) {
          let history: Array<{ role: "user" | "assistant"; content: string }> = [];
          if (parsed.data.conversationId) {
            const conv = getConversation(parsed.data.conversationId);
            if (conv) {
              history = conv.messages
                .filter(
                  (m): m is typeof m & { role: "user" | "assistant" } =>
                    m.role === "user" || m.role === "assistant"
                )
                .map((m) => ({ role: m.role, content: m.content }))
                .slice(-3);
            }
          }

          classifierResult = await classifyIntent(
            parsed.data.content,
            history,
            classifierConfig,
            profile,
            classifierModel,
            app.log
          );
        }
      } catch (err) {
        app.log.warn({ err: String(err) }, "Classifier: unexpected error in chat route");
        classifierResult = { intent: "chat", confidence: 0 };
      }

      const latencyMs = Date.now() - classifierStart;
      const effectiveIntent =
        classifierResult.confidence >= classifierConfig.confidenceThreshold
          ? classifierResult.intent
          : "chat";

      app.log.info(
        {
          intent: classifierResult.intent,
          confidence: classifierResult.confidence,
          effectiveIntent,
          latencyMs,
          threshold: classifierConfig.confidenceThreshold,
          rawPreview: (classifierResult as { debug?: { raw?: string } }).debug?.raw?.slice(0, 200),
        },
        "Intent classified"
      );

      if (effectiveIntent === "task") {
        classifierReasoningText = `Analyzing intent: task detected (confidence: ${classifierResult.confidence.toFixed(2)}) — responding in chat mode\n`;
      } else {
        classifierReasoningText = `Analyzing intent: chat (confidence: ${classifierResult.confidence.toFixed(2)})\n`;
      }
    }

    // ── Resolve tools ────────────────────────────────────────────────────────
    const effectiveIntentForTools: "chat" | "task" =
      classifierConfig.enabled &&
      classifierResult.confidence >= classifierConfig.confidenceThreshold &&
      classifierResult.intent === "task"
        ? "task"
        : "chat";

    const tools = await getToolsForIntent(effectiveIntentForTools);

    // Inject schedule_setup tool for schedule conversations
    if (isScheduleConversation) {
      const scheduleTool = await getToolDefinitions(["schedule_setup"]);
      tools.push(...scheduleTool);
    }

    // ── Memory context retrieval ─────────────────────────────────────────────
    let memoryContext: string | undefined;
    try {
      memoryContext = await memory.query({
        userId: LOCAL_USER,
        chatId: parsed.data.conversationId ?? "",
        currentMessage: parsed.data.content,
      });
    } catch {
      // Memory errors must not block chat
    }

    // ── Main streaming call ──────────────────────────────────────────────────
    try {
      const generation = await generateAssistantReply({
        ...parsed.data,
        conversationType: isScheduleConversation ? "schedule" : undefined,
        tools,
        memoryContext,
        memorySearchFn: createMemorySearchFn(),
        agentMode: effectiveIntentForTools,
        agentSystemPrompt: isScheduleConversation
          ? SCHEDULE_SYSTEM_PROMPT
          : effectiveIntentForTools === "task"
            ? AGENT_TASK_SYSTEM_PROMPT
            : undefined,
      });

      sse.send("meta", {
        conversationId: generation.conversation.id,
        userMessageId: generation.userMessageId,
      });

      let content = "";
      let reasoning = classifierReasoningText ?? "";
      const widgets: VisualizerWidget[] = [];
      const blocks: ContentBlock[] = [];

      if (classifierReasoningText) {
        sse.send("delta", { reasoning: classifierReasoningText });
      }

      let assistantMetaSent = false;
      for await (const chunk of generation.stream) {
        const assistantMessageId = generation.getAssistantMessageId();
        if (assistantMessageId && !assistantMetaSent) {
          sse.send("meta", {
            conversationId: generation.conversation.id,
            userMessageId: generation.userMessageId,
            assistantMessageId,
          });
          assistantMetaSent = true;
        }
        if (chunk.questions) {
          savePendingInteraction(generation.conversation.id, "ask_user", {
            questions: chunk.questions,
          });
          sse.send("ask_user", { questions: chunk.questions });
          continue;
        }
        if (chunk.scheduleReady) {
          sse.send("schedule_ready", chunk.scheduleReady);
          continue;
        }
        if (chunk.permissionRequired) {
          savePendingInteraction(
            generation.conversation.id,
            "permission",
            chunk.permissionRequired as Record<string, unknown>
          );
          sse.send("permission_required", chunk.permissionRequired);
          continue;
        }
        if (chunk.widgetLoading) {
          sse.send("widget_loading", { title: chunk.widgetTitle ?? "" });
          continue;
        }
        if (chunk.widgetFailed) {
          sse.send("widget_failed", {});
          continue;
        }
        if (chunk.widget) {
          blocks.push({ type: "widget", index: widgets.length });
          widgets.push(chunk.widget);
          sse.send("widget", chunk.widget);
          continue;
        }

        if (chunk.reasoning) {
          reasoning += chunk.reasoning;
          const last = blocks[blocks.length - 1];
          if (last?.type === "reasoning") {
            last.content += chunk.reasoning;
          } else {
            blocks.push({ type: "reasoning", content: chunk.reasoning });
          }
        }
        if (chunk.content) {
          content += chunk.content;
          const last = blocks[blocks.length - 1];
          if (last?.type === "text") {
            last.content += chunk.content;
          } else {
            blocks.push({ type: "text", content: chunk.content });
          }
        }
        sse.send("delta", chunk);
      }

      const finalizeBlocks = blocks.filter(
        (b): b is { type: "text"; content: string } | { type: "widget"; index: number } =>
          b.type === "text" || b.type === "widget"
      );
      const conversation = generation.finalize(content, reasoning, widgets, finalizeBlocks);
      const summary = getConversationSummary(conversation.id);
      if (summary) {
        conversationEvents.publish({ type: "upsert", conversation: summary });
      }
      sse.send("done", { conversation });
      sse.close();
      titleService.schedule(conversation.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate response.";
      sse.send("error", { message });
      sse.close();
    }
  });

  app.post("/api/chat/ephemeral", async (request, reply) => {
    const parsed = ephemeralChatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const sse = createEphemeralSse(reply);

    try {
      const { stream } = generateEphemeralReply(parsed.data);
      let content = "";
      let reasoning = "";
      for await (const chunk of stream) {
        if (chunk.reasoning) {
          reasoning += chunk.reasoning;
        }
        if (chunk.content) {
          content += chunk.content;
        }
        sse.send("delta", chunk);
      }
      sse.send("done", { content, reasoning: reasoning || undefined });
      sse.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate response.";
      sse.send("error", { message });
      sse.close();
    }
  });
}
