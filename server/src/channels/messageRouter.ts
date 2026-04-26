/**
 * messageRouter — receives an inbound message from any channel, routes it
 * through the full AI pipeline (memory, tools, intent classification), and
 * returns the reply text.
 *
 * Each (channelId, senderId) pair maps to a persistent conversation so context
 * is preserved across messages.
 */

import { db } from "../db/database.js";
import { deleteMessagesFromId, getSettings, listUserModels } from "../db/repository.js";
import { getProfile } from "../providers/index.js";
import { generateAssistantReply } from "../services/chat-service.js";
import { checkChannelSenderAccess } from "../services/channelAccess.js";
import {
  consumeChannelCapabilityGrantOnce,
  getChannelCapabilityDecision,
  requestChannelCapabilityApproval,
} from "../services/channelCapabilityPermissions.js";
import { createConversationSearchFn, createMemorySearchFn } from "../services/search.js";
import {
  classifyIntent,
  getClassifierConfig,
  resolveClassifierModel,
} from "../classifier/intentClassifier.js";
import { getToolsForIntent } from "../skills/skillsConfig.js";
import { AGENT_TASK_SYSTEM_PROMPT } from "../utils/constants.js";
import type { MemoryModule } from "../memory/types.js";
import type { ChannelId } from "../types.js";

const LOCAL_USER = "local_user";

// ─── Memory singleton — set once at server startup via initMessageRouter() ────

let _memory: MemoryModule | null = null;

export function initMessageRouter(memory: MemoryModule): void {
  _memory = memory;
}

const CHANNEL_UNSUPPORTED_TOOLS = new Set(["visualize__read_me", "visualize__show_widget"]);

// ─── DB helpers ───────────────────────────────────────────────────────────────

export interface IncomingMessage {
  connectionId: string;
  channelId: ChannelId;
  /** Platform-specific user/chat identifier */
  senderId: string;
  senderName: string | null;
  conversationKey?: string;
  replyTargetId: string;
  replyThreadId?: string | null;
  replyMessageId?: string | null;
  text: string;
}

function getChannelCapabilityScopeKey(msg: IncomingMessage): string {
  return `${msg.connectionId}:target:${msg.replyTargetId}`;
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
  const key = msg.conversationKey ?? `${msg.connectionId}:${msg.senderId}`;
  const capabilityScopeKey = getChannelCapabilityScopeKey(msg);
  let channelApprovalNotice: string | null = null;

  const senderAccess = await checkChannelSenderAccess({
    connectionId: msg.connectionId,
    channelId: msg.channelId,
    senderId: msg.senderId,
    senderName: msg.senderName,
    conversationKey: key,
    replyTargetId: msg.replyTargetId,
    replyThreadId: msg.replyThreadId,
    replyMessageId: msg.replyMessageId,
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

  const tools = (await getToolsForIntent(intent)).filter(
    (tool) => !CHANNEL_UNSUPPORTED_TOOLS.has(tool.function.name)
  );

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
    agentSystemPrompt: intent === "task" ? AGENT_TASK_SYSTEM_PROMPT : undefined,
    memoryContext,
    memorySearchFn: createMemorySearchFn(LOCAL_USER),
    conversationSearchFn: createConversationSearchFn(),
    includeToolTags: false,
    agentMode: intent,
    permissionController: {
      check: ({ capability }) =>
        getChannelCapabilityDecision(msg.connectionId, capabilityScopeKey, capability),
      onPrompt: ({ skillName, capability }) => {
        const status = requestChannelCapabilityApproval({
          connectionId: msg.connectionId,
          channelId: msg.channelId,
          scopeKey: capabilityScopeKey,
          conversationKey: key,
          senderId: msg.senderId,
          senderName: msg.senderName,
          replyTargetId: msg.replyTargetId,
          replyThreadId: msg.replyThreadId,
          replyMessageId: msg.replyMessageId,
          skillName,
          capability,
          text: msg.text,
        });
        channelApprovalNotice =
          status === "created"
            ? `I need approval in the Elaine app before I can use ${skillName} (${capability}) in this chat. Open Elaine Notifications and choose Allow once, Allow in this chat, or Deny.`
            : `I'm still waiting for approval in the Elaine app to use ${skillName} (${capability}) in this chat. Open Elaine Notifications to Allow once, Allow in this chat, or Deny.`;
      },
      onConsume: ({ capability }) => {
        consumeChannelCapabilityGrantOnce(msg.connectionId, capabilityScopeKey, capability);
      },
    },
  });

  saveConversationId(key, generation.conversation.id);

  let content = "";
  let reasoning = "";
  let permissionRequested = false;
  for await (const chunk of generation.stream) {
    if (chunk.content) content += chunk.content;
    if (chunk.reasoning) reasoning += chunk.reasoning;
    if (chunk.permissionRequired) permissionRequested = true;
  }

  if (permissionRequested) {
    deleteMessagesFromId(generation.userMessageId);
    generation.fail();
    return channelApprovalNotice ?? "I need approval in the Elaine app before I can continue.";
  }

  generation.finalize(content, reasoning, [], []);
  if (content.trim()) {
    return content;
  }

  return "I couldn't produce a final reply for that message. Please try rephrasing it.";
}
