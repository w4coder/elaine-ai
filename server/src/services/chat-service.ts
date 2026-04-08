import {
  createConversation,
  createMessage,
  deleteMessage,
  deleteMessagesFromId,
  getConversation,
  getSettings,
  getUserProfile,
  updateMessage,
  updateConversation,
} from "../db/repository.js";
import { getProfile, getProviderAdapter } from "../providers/index.js";
import { runAgentStream } from "./agentLoop.js";
import { buildUserProfilePrompt, VISUALIZER_SYSTEM_PROMPT } from "../utils/constants.js";
import type {
  ConversationDetail,
  ImageAttachment,
  ProviderMessage,
  ProviderStreamChunk,
  ToolDefinition,
  VisualizerWidget,
} from "../types.js";

export interface EphemeralChatPayload {
  profileId?: string;
  model?: string;
  systemPrompt?: string;
  content: string;
  images?: ImageAttachment[];
  messages: Array<{ role: "user" | "assistant"; content: string; images?: ImageAttachment[] }>;
}

export interface ChatPayload {
  conversationId?: string;
  truncateFromMessageId?: string;
  content: string;
  images?: ImageAttachment[];
  profileId?: string;
  model?: string;
  systemPrompt?: string;
  workspacePath?: string | null;
  conversationType?: "chat" | "schedule" | "scheduled_run";
  /** Pre-set title; if provided alongside titleSource:"manual" the title service will skip this conversation. */
  title?: string;
  /** Tools to expose to the model.  When empty the direct streamChat path is used. */
  tools?: ToolDefinition[];
  /** Drives iteration cap in the agent loop. */
  agentMode?: "chat" | "task" | "scheduled";
  /** Extra system prompt injected after the conversation system prompt (task mode). */
  agentSystemPrompt?: string;
  /** Memory context injected into the system prompt (from memory module). */
  memoryContext?: string;
  /**
   * Optional function exposed to skills via context so they can search the
   * user's memory notes.  Signature matches what memory_search.skill.js expects.
   */
  memorySearchFn?: (
    query: string,
    limit?: number
  ) => Array<{
    kind: string;
    summary: string;
    confidence: number;
    scope: string;
    entities: string[];
  }>;
  conversationSearchFn?: (
    query: string,
    limit?: number
  ) => Array<{
    conversationId: string;
    title: string;
    updatedAt: string;
    messageId: string;
    role: "user" | "assistant";
    snippet: string;
    score: number;
  }>;
  /** Execute tools without waiting for interactive permission approval. */
  autoApproveTools?: boolean;
  /** When false, omit trailing tool recap tags from the final response. */
  includeToolTags?: boolean;
}

function getOllamaThinkSetting(model: string): boolean | "low" | "medium" | "high" {
  const normalized = model.trim().toLowerCase();

  if (/\bgpt-oss(?=[:-]|$)/.test(normalized)) {
    return "medium";
  }

  if (
    /\bqwen-?3(?:\.\d+)?(?=[:-]|$)/.test(normalized) ||
    /\bdeepseek-r1(?=[:-]|$)/.test(normalized) ||
    /\bdeepseek-v3\.1(?=[:-]|$)/.test(normalized) ||
    /\bdeepseek-v3_1(?=[:-]|$)/.test(normalized) ||
    /\bdeepseek-v3-1(?=[:-]|$)/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function getThinkSetting(
  providerType: string,
  model: string
): boolean | "low" | "medium" | "high" | undefined {
  if (providerType !== "ollama") {
    return undefined;
  }

  return getOllamaThinkSetting(model);
}

function getMessageImages(metadata: Record<string, unknown> | null): ImageAttachment[] {
  if (!metadata || !Array.isArray(metadata.images)) {
    return [];
  }

  return metadata.images.filter(
    (image): image is ImageAttachment =>
      typeof image === "object" &&
      image !== null &&
      typeof image.name === "string" &&
      typeof image.mimeType === "string" &&
      typeof image.dataUrl === "string"
  );
}

function toProviderImages(images: ImageAttachment[]): string[] | undefined {
  const encoded = images
    .map((image) => (image.dataUrl.includes(",") ? image.dataUrl.split(",", 2)[1] : image.dataUrl))
    .filter((image) => image.length > 0);

  return encoded.length ? encoded : undefined;
}

function buildProviderMessages(
  conversation: ConversationDetail,
  agentSystemPrompt?: string,
  memoryContext?: string,
  userProfileSection?: string
): ProviderMessage[] {
  const systemParts = [conversation.systemPrompt];

  if (userProfileSection?.trim()) {
    systemParts.push(userProfileSection.trim());
  }
  if (conversation.workspacePath?.trim()) {
    systemParts.push(
      `Workspace focus: ${conversation.workspacePath}. Treat this path as the primary project context when suggesting code, commands, or edits.`
    );
  }
  if (memoryContext?.trim()) {
    systemParts.push(memoryContext.trim());
  }
  if (agentSystemPrompt?.trim()) {
    systemParts.push(agentSystemPrompt.trim());
  }
  systemParts.push(VISUALIZER_SYSTEM_PROMPT);

  const messages: ProviderMessage[] = [
    {
      role: "system",
      content: systemParts.join("\n\n"),
    },
  ];

  for (const message of conversation.messages) {
    if (message.role === "system") {
      messages.push({ role: "system", content: message.content });
      continue;
    }

    if (message.role === "tool") {
      messages.push({
        role: "assistant",
        content: `Tool output${message.toolName ? ` (${message.toolName})` : ""}:\n${message.content}`,
      });
      continue;
    }

    messages.push({
      role: message.role,
      content: message.content,
      images: toProviderImages(getMessageImages(message.metadata)),
    });
  }

  return messages;
}

export function prepareConversation(payload: ChatPayload): ConversationDetail {
  const settings = getSettings();
  const profile = getProfile(settings, payload.profileId);

  if (payload.conversationId) {
    const current = getConversation(payload.conversationId);
    if (!current) {
      throw new Error("Conversation not found.");
    }

    const model = payload.model?.trim() || current.model.trim();
    if (!model) {
      throw new Error("No model selected.");
    }

    const updated = updateConversation(payload.conversationId, {
      profileId: profile.id,
      providerType: profile.providerType,
      model,
      systemPrompt: payload.systemPrompt?.trim() || settings.defaultSystemPrompt,
      workspacePath: payload.workspacePath?.trim() || null,
    });

    if (!updated) {
      throw new Error("Conversation not found.");
    }

    const detail = getConversation(updated.id);
    if (!detail) {
      throw new Error("Conversation not found.");
    }

    return detail;
  }

  const model = payload.model?.trim();
  if (!model) {
    throw new Error("No model selected.");
  }

  const created = createConversation({
    title: payload.title,
    titleSource: payload.title ? "manual" : undefined,
    profileId: profile.id,
    providerType: profile.providerType,
    model,
    systemPrompt: payload.systemPrompt?.trim() || settings.defaultSystemPrompt,
    workspacePath: payload.workspacePath?.trim() || null,
    conversationType: payload.conversationType,
  });

  const detail = getConversation(created.id);
  if (!detail) {
    throw new Error("Failed to create conversation.");
  }

  return detail;
}

export async function generateAssistantReply(payload: ChatPayload): Promise<{
  conversation: ConversationDetail;
  userMessageId: string;
  stream: AsyncGenerator<ProviderStreamChunk>;
  getAssistantMessageId(): string | null;
  finalize(
    content: string,
    reasoning: string,
    widgets?: VisualizerWidget[],
    blocks?: Array<{ type: "text"; content: string } | { type: "widget"; index: number }>
  ): ConversationDetail;
  fail(): void;
}> {
  const settings = getSettings();
  const conversation = prepareConversation(payload);
  const profile = getProfile(settings, payload.profileId ?? conversation.profileId);
  const model = payload.model?.trim() || conversation.model;

  if (!model) {
    throw new Error("No model selected.");
  }

  if (payload.truncateFromMessageId) {
    deleteMessagesFromId(payload.truncateFromMessageId);
  }

  const userMessage = createMessage({
    conversationId: conversation.id,
    role: "user",
    content: payload.content.trim(),
    metadata: payload.images?.length ? { images: payload.images } : null,
  });

  if (conversation.titleSource !== "manual") {
    updateConversation(conversation.id, {
      titleStatus: "pending",
    });
  }

  const hydrated = getConversation(conversation.id);
  if (!hydrated) {
    throw new Error("Conversation not found after message creation.");
  }

  const userProfile = getUserProfile();
  const userProfileSection = userProfile ? buildUserProfilePrompt(userProfile) : undefined;

  const adapter = getProviderAdapter(profile.providerType);
  const tools = payload.tools ?? [];
  const think = getThinkSetting(profile.providerType, model);
  const builtMessages = buildProviderMessages(
    hydrated,
    payload.agentSystemPrompt,
    payload.memoryContext,
    userProfileSection
  );

  const providerStream =
    tools.length > 0
      ? runAgentStream({
          adapter,
          profile,
          model,
          messages: builtMessages,
          tools,
          think,
          mode: (payload.agentMode ?? "chat") as "chat" | "task" | "scheduled",
          autoApproveTools: payload.autoApproveTools,
          includeToolTags: payload.includeToolTags,
          skillContext: {
            conversationId: conversation.id,
            ...(payload.workspacePath ? { workspacePath: payload.workspacePath } : {}),
            ...(payload.memorySearchFn ? { memorySearch: payload.memorySearchFn } : {}),
            ...(payload.conversationSearchFn
              ? { conversationSearch: payload.conversationSearchFn }
              : {}),
          },
        })
      : adapter.streamChat({ profile, model, messages: builtMessages, think });

  let assistantMessageId: string | null = null;
  const stream = (async function* (): AsyncGenerator<ProviderStreamChunk> {
    for await (const chunk of providerStream) {
      // toolCalls chunks are internal agent-loop signals; never forward to client
      if (chunk.toolCalls) continue;

      if (!assistantMessageId && (chunk.content || chunk.reasoning)) {
        assistantMessageId = createMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: "",
        }).id;
      }

      yield chunk;
    }
  })();

  return {
    conversation: hydrated,
    userMessageId: userMessage.id,
    stream,
    getAssistantMessageId() {
      return assistantMessageId;
    },
    finalize(content, reasoning, widgets, blocks) {
      if (!assistantMessageId && (content.trim() || reasoning.trim())) {
        assistantMessageId = createMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: "",
        }).id;
      }

      if (assistantMessageId) {
        const metadata: Record<string, unknown> = {};
        if (reasoning.trim()) metadata.reasoning = reasoning.trim();
        if (widgets?.length) metadata.widgets = widgets;
        // Persist block order so the renderer can interleave text and widgets correctly
        if (blocks?.length && widgets?.length) metadata.blocks = blocks;
        updateMessage(assistantMessageId, {
          content: content.trim(),
          metadata: Object.keys(metadata).length ? metadata : null,
        });
      }

      const latest = getConversation(conversation.id);
      if (!latest) {
        throw new Error("Conversation not found after response generation.");
      }
      return latest;
    },
    fail() {
      if (assistantMessageId) {
        deleteMessage(assistantMessageId);
      }
    },
  };
}

export function generateEphemeralReply(payload: EphemeralChatPayload): {
  stream: AsyncGenerator<ProviderStreamChunk>;
} {
  const settings = getSettings();
  const profile = getProfile(settings, payload.profileId);
  const model = payload.model?.trim();

  if (!model) {
    throw new Error("No model selected.");
  }

  const systemPrompt = payload.systemPrompt?.trim() || settings.defaultSystemPrompt;

  const messages: ProviderMessage[] = [
    { role: "system", content: systemPrompt },
    ...payload.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      images: toProviderImages(m.images ?? []),
    })),
    {
      role: "user",
      content: payload.content.trim(),
      images: toProviderImages(payload.images ?? []),
    },
  ];

  const adapter = getProviderAdapter(profile.providerType);
  const stream = adapter.streamChat({
    profile,
    model,
    messages,
    think: getThinkSetting(profile.providerType, model),
  });

  return { stream };
}
