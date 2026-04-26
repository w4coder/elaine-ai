import { randomUUID } from "node:crypto";
import {
  createNotification,
  createPendingChannelCapabilityRequest,
  deletePendingChannelCapabilityRequests,
  deleteChannelCapabilityGrant,
  getChannelCapabilityGrant,
  getNotification,
  listNotifications,
  updateNotification,
  upsertChannelCapabilityGrant,
} from "../db/repository.js";
import { notificationBus } from "./notification-bus.js";
import { nowIso } from "../utils/time.js";
import type { AppNotification, ChannelCapabilityGrantType, ChannelId } from "../types.js";

export interface ChannelCapabilityRequestInput {
  connectionId: string;
  channelId: ChannelId;
  scopeKey: string;
  conversationKey: string;
  senderId: string;
  senderName: string | null;
  replyTargetId: string;
  replyThreadId?: string | null;
  replyMessageId?: string | null;
  skillName: string;
  capability: string;
  text: string;
}

export type ChannelCapabilityDecision = "allow" | "prompt" | "deny";

function publishNotification(notification: AppNotification): void {
  notificationBus.publish({
    type: "notification_created",
    notification,
  });
}

function findExistingCapabilityNotification(
  connectionId: string,
  scopeKey: string,
  capability: string
): AppNotification | null {
  return (
    listNotifications({ limit: 200, unreadOnly: false }).find((notification) => {
      if (notification.type !== "channel_capability_request") {
        return false;
      }

      const metadata = notification.metadata;
      return (
        metadata?.connectionId === connectionId &&
        (metadata?.status === undefined || metadata?.status === "pending") &&
        (metadata?.scopeKey === scopeKey || metadata?.conversationKey === scopeKey) &&
        metadata?.capability === capability
      );
    }) ?? null
  );
}

function buildCapabilityStatusBody(params: {
  skillName: string | null;
  capability: string;
  senderLabel: string;
  status: "processing" | "completed" | "denied";
  resolution: ChannelCapabilityGrantType;
}): string {
  const actionLabel =
    params.resolution === "chat"
      ? "Allowed in this chat"
      : params.resolution === "once"
        ? "Allowed once"
        : "Denied";
  const requestSummary = params.skillName
    ? `The channel agent wants to use ${params.skillName} (${params.capability}) in this chat for ${params.senderLabel}.`
    : `The channel agent wants to use ${params.capability} in this chat for ${params.senderLabel}.`;

  if (params.status === "processing") {
    return `${requestSummary} Status: ${actionLabel}. Processing the request now.`;
  }

  if (params.status === "denied") {
    return `${requestSummary} Status: ${actionLabel}.`;
  }

  return `${requestSummary} Status: ${actionLabel}. Request processed.`;
}

export function markChannelCapabilityNotificationStatus(input: {
  notificationId?: string;
  connectionId: string;
  scopeKey: string;
  capability: string;
  status: "processing" | "completed" | "denied";
  resolution: ChannelCapabilityGrantType;
}): AppNotification | null {
  const notification =
    (input.notificationId ? getNotification(input.notificationId) : null) ??
    findExistingCapabilityNotification(input.connectionId, input.scopeKey, input.capability);

  if (!notification) {
    return null;
  }

  const metadata = notification.metadata ?? {};
  const senderLabel =
    typeof metadata.senderName === "string" && metadata.senderName.trim()
      ? metadata.senderName
      : typeof metadata.senderId === "string"
        ? metadata.senderId
        : "this sender";
  const skillName = typeof metadata.skillName === "string" ? metadata.skillName : null;

  return updateNotification(notification.id, {
    read: true,
    body: buildCapabilityStatusBody({
      skillName,
      capability: input.capability,
      senderLabel,
      status: input.status,
      resolution: input.resolution,
    }),
    metadata: {
      ...metadata,
      status: input.status,
      resolution: input.resolution,
    },
  });
}

export function getChannelCapabilityDecision(
  connectionId: string,
  conversationKey: string,
  capability: string
): ChannelCapabilityDecision {
  const grant = getChannelCapabilityGrant(connectionId, conversationKey, capability);
  if (!grant) {
    return "prompt";
  }

  if (grant.decision === "deny") {
    return "deny";
  }

  return "allow";
}

export function consumeChannelCapabilityGrantOnce(
  connectionId: string,
  conversationKey: string,
  capability: string
): void {
  const grant = getChannelCapabilityGrant(connectionId, conversationKey, capability);
  if (grant?.decision === "once") {
    deleteChannelCapabilityGrant(connectionId, conversationKey, capability);
  }
}

export function saveChannelCapabilityDecision(data: {
  connectionId: string;
  conversationKey: string;
  capability: string;
  type: ChannelCapabilityGrantType;
}): void {
  upsertChannelCapabilityGrant({
    connectionId: data.connectionId,
    conversationKey: data.conversationKey,
    capability: data.capability,
    decision: data.type,
  });
}

export function requestChannelCapabilityApproval(
  input: ChannelCapabilityRequestInput
): "created" | "existing" {
  const existing = findExistingCapabilityNotification(
    input.connectionId,
    input.scopeKey,
    input.capability
  );

  // Keep only the newest blocked request for a given channel chat + capability.
  // Repeated "retry" messages should update the pending request, not build a backlog.
  deletePendingChannelCapabilityRequests(input.connectionId, input.scopeKey, input.capability);

  createPendingChannelCapabilityRequest({
    id: randomUUID(),
    connectionId: input.connectionId,
    channelId: input.channelId,
    scopeKey: input.scopeKey,
    conversationKey: input.conversationKey,
    senderId: input.senderId,
    senderName: input.senderName,
    replyTargetId: input.replyTargetId,
    replyThreadId: input.replyThreadId ?? null,
    replyMessageId: input.replyMessageId ?? null,
    capability: input.capability,
    skillName: input.skillName,
    text: input.text,
    createdAt: nowIso(),
  });
  if (existing) {
    return "existing";
  }

  const preview = input.text.replace(/\s+/g, " ").trim().slice(0, 280);
  const senderLabel = input.senderName?.trim() || input.senderId;
  const notification = createNotification({
    id: randomUUID(),
    type: "channel_capability_request",
    title: `Allow ${input.capability} for ${senderLabel}?`,
    body:
      `The channel agent wants to use ${input.skillName} (${input.capability}) in this chat.` +
      (preview ? ` Incoming message: ${preview}${preview.length >= 280 ? "..." : ""}` : ""),
    targetUrl: "/notifications",
    metadata: {
      connectionId: input.connectionId,
      channelId: input.channelId,
      scopeKey: input.scopeKey,
      conversationKey: input.conversationKey,
      senderId: input.senderId,
      senderName: input.senderName,
      replyTargetId: input.replyTargetId,
      replyThreadId: input.replyThreadId ?? null,
      replyMessageId: input.replyMessageId ?? null,
      skillName: input.skillName,
      capability: input.capability,
      status: "pending",
      messagePreview: preview,
    },
  });
  publishNotification(notification);
  return "created";
}
