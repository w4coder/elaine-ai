import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  createConversation,
  createMessage,
  deleteConversation,
  getConversation,
  getConversationSummary,
  getSettings,
  listConversations,
  updateConversation,
} from "../db/repository.js";
import { getProfile } from "../providers/index.js";
import { conversationEvents } from "../services/conversation-events.js";
import { createGenericSse } from "../utils/sse.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const conversationUpdateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  profileId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  workspacePath: z.string().nullable().optional(),
});

const conversationCreateSchema = conversationUpdateSchema.extend({
  profileId: z.string().min(1),
  model: z.string().min(1),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  // Server-sent events stream for real-time conversation list updates
  app.get("/api/events/conversations", async (_request, reply) => {
    const sse = createGenericSse(reply);
    const unsubscribe = conversationEvents.subscribe((event) => {
      sse.send(event.type, event);
    });
    sse.onClose(() => {
      unsubscribe();
    });
  });

  app.get("/api/conversations", async () => listConversations());

  app.post("/api/conversations", async (request, reply) => {
    const parsed = conversationCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const settings = getSettings();
    const profile = getProfile(settings, parsed.data.profileId);
    const created = createConversation({
      title: parsed.data.title,
      profileId: profile.id,
      providerType: profile.providerType,
      model: parsed.data.model,
      systemPrompt: parsed.data.systemPrompt ?? settings.defaultSystemPrompt,
      workspacePath: parsed.data.workspacePath ?? null,
    });

    return getConversation(created.id);
  });

  app.get("/api/conversations/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const conversation = getConversation(params.data.id);
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }

    return conversation;
  });

  app.patch("/api/conversations/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = conversationUpdateSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: {
          params: params.success ? null : params.error.flatten(),
          body: body.success ? null : body.error.flatten(),
        },
      });
    }

    const current = getConversation(params.data.id);
    if (!current) {
      return reply.code(404).send({ error: "Conversation not found" });
    }

    const settings = getSettings();
    const profile = body.data.profileId ? getProfile(settings, body.data.profileId) : null;
    const updated = updateConversation(params.data.id, {
      title: body.data.title?.trim() || undefined,
      titleSource: body.data.title ? "manual" : undefined,
      profileId: profile?.id,
      providerType: profile?.providerType,
      model: body.data.model,
      systemPrompt: body.data.systemPrompt,
      workspacePath:
        body.data.workspacePath === undefined ? undefined : body.data.workspacePath?.trim() || null,
    });

    const summary = getConversationSummary(params.data.id);
    if (summary) {
      conversationEvents.publish({ type: "upsert", conversation: summary });
    }

    return updated;
  });

  app.post("/api/conversations/:id/messages", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({ role: z.enum(["assistant", "system"]), content: z.string().min(1) })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "Invalid request." });
    }

    const conversation = getConversation(params.data.id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    createMessage({
      conversationId: params.data.id,
      role: body.data.role,
      content: body.data.content,
      metadata: null,
    });
    return getConversation(params.data.id);
  });

  app.delete("/api/conversations/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    deleteConversation(params.data.id);
    conversationEvents.publish({ type: "delete", conversationId: params.data.id });
    return reply.code(204).send();
  });
}
