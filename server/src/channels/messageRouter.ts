/**
 * messageRouter — receives an inbound message from any channel, routes it
 * through the full AI pipeline (memory, tools, intent classification), and
 * returns the reply text.
 *
 * Each (channelId, senderId) pair maps to a persistent conversation so context
 * is preserved across messages.
 */

import { db } from "../db/database.js";
import { getSettings, listUserModels } from "../db/repository.js";
import { getProfile } from "../providers/index.js";
import { generateAssistantReply } from "../services/chat-service.js";
import { checkChannelSenderAccess } from "../services/channelAccess.js";
import { createConversationSearchFn, createMemorySearchFn } from "../services/search.js";
import { getToolsForIntent } from "../skills/skillsConfig.js";
import {
  classifyIntent,
  getClassifierConfig,
  resolveClassifierModel,
} from "../classifier/intentClassifier.js";
import type { MemoryModule } from "../memory/types.js";
import type { ChannelId } from "../types.js";

const LOCAL_USER = "local_user";

// ─── Memory singleton — set once at server startup via initMessageRouter() ────

let _memory: MemoryModule | null = null;

export function initMessageRouter(memory: MemoryModule): void {
  _memory = memory;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export interface IncomingMessage {
  connectionId: string;
  channelId: ChannelId;
  /** Platform-specific user/chat identifier */
  senderId: string;
  senderName: string | null;
  replyTargetId: string;
  text: string;
}

function getStoredConversationId(key: string): string | undefined {
  const row = db
    .prepare("SELECT conversation_id FROM channel_conversations WHERE channel_key = ?")
    .get(key) as { conversation_id: string } | undefined;
  return row?.conversation_id;
}

function saveConversationId(key: string, conversationId: string): void {
  db.prepare(
    `INSERT INTO channel_conversations (channel_key, conversation_id)
     VALUES (?, ?)
     ON CONFLICT(channel_key) DO UPDATE SET conversation_id = excluded.conversation_id`
  ).run(key, conversationId);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function routeMessage(msg: IncomingMessage): Promise<string> {
  const settings = getSettings();
  const key = `${msg.connectionId}:${msg.senderId}`;

  const senderAccess = await checkChannelSenderAccess({
    connectionId: msg.connectionId,
    channelId: msg.channelId,
    senderId: msg.senderId,
    senderName: msg.senderName,
    replyTargetId: msg.replyTargetId,
    text: msg.text,
  });

  if (senderAccess === "pending") {
    return "";
  }

  if (senderAccess?.status === "blocked") {
    return "";
  }

  const existingConversationId = getStoredConversationId(key);

  // Resolve default model — needed when creating a new conversation
  const profile = getProfile(settings, settings.activeProfileId);
  const model = profile.defaultModel?.trim() || listUserModels(profile.id)[0]?.model?.trim() || "";

  if (!model) {
    throw new Error("[messageRouter] No model configured — set a default model in Settings");
  }

  // ── Intent classification → tools ─────────────────────────────────────────
  const classifierConfig = getClassifierConfig();
  let intent: "chat" | "task" = "chat";

  if (classifierConfig.enabled) {
    try {
      const classifierModel = resolveClassifierModel(model);
      const result = await classifyIntent(msg.text, [], classifierConfig, profile, classifierModel);
      if (result.confidence >= classifierConfig.confidenceThreshold) {
        intent = result.intent;
      }
    } catch {
      // Classifier failure must not block the reply
    }
  }

  const tools = await getToolsForIntent(intent);

  // ── Memory context ────────────────────────────────────────────────────────
  let memoryContext: string | undefined;
  if (_memory) {
    try {
      memoryContext = await _memory.query({
        userId: LOCAL_USER,
        chatId: existingConversationId ?? key,
        currentMessage: msg.text,
      });
    } catch {
      // Memory errors must not block the reply
    }
  }

  // ── Memory search function ────────────────────────────────────────────────
  // ── Generate reply ────────────────────────────────────────────────────────
  const generation = await generateAssistantReply({
    conversationId: existingConversationId,
    content: msg.text,
    systemPrompt: settings.defaultSystemPrompt,
    profileId: profile.id,
    model,
    tools,
    memoryContext,
    memorySearchFn: createMemorySearchFn(LOCAL_USER),
    conversationSearchFn: createConversationSearchFn(),
    autoApproveTools: true,
    includeToolTags: false,
    agentMode: intent,
  });

  saveConversationId(key, generation.conversation.id);

  let content = "";
  let reasoning = "";
  for await (const chunk of generation.stream) {
    if (chunk.content) content += chunk.content;
    if (chunk.reasoning) reasoning += chunk.reasoning;
  }

  generation.finalize(content, reasoning, [], []);
  if (content.trim()) {
    return content;
  }

  return "I couldn't produce a final reply for that message. Please try rephrasing it.";
}
