import { randomUUID } from "node:crypto";
import {
  createPendingChannelMessage,
  createNotification,
  deletePendingChannelMessagesForSender,
  getChannelSenderPermission,
  listPendingChannelMessages,
  listNotifications,
} from "../db/repository.js";
import { notificationBus } from "./notification-bus.js";
import { nowIso } from "../utils/time.js";
import type {
  AppNotification,
  ChannelId,
  ChannelSenderPermission,
  PendingChannelMessage,
} from "../types.js";

export interface ChannelSenderGateInput {
  connectionId: string;
  channelId: ChannelId;
  senderId: string;
  senderName: string | null;
  conversationKey: string;
  replyTargetId: string;
  replyThreadId?: string | null;
  replyMessageId?: string | null;
  text: string;
}

function normalizeSenderDisplayName(senderId: string, senderName: string | null): string {
  return senderName?.trim() || senderId;
}

function publishNotification(notification: AppNotification): void {
  notificationBus.publish({
    type: "notification_created",
    notification,
  });
}

function findExistingPendingRequest(
  connectionId: string,
  senderId: string
): AppNotification | null {
  return (
    listNotifications({ limit: 200, unreadOnly: false }).find((notification) => {
      if (notification.type !== "channel_permission_request") return false;
      const metadata = notification.metadata;
      return metadata?.connectionId === connectionId && metadata?.senderId === senderId;
    }) ?? null
  );
}

export async function checkChannelSenderAccess(
  input: ChannelSenderGateInput
): Promise<ChannelSenderPermission | "pending" | null> {
  const permission = getChannelSenderPermission(input.connectionId, input.senderId);
  if (permission) {
    return permission;
  }

  const existing = findExistingPendingRequest(input.connectionId, input.senderId);
  createPendingChannelMessage({
    id: randomUUID(),
    connectionId: input.connectionId,
    channelId: input.channelId,
    senderId: input.senderId,
    senderName: input.senderName,
    conversationKey: input.conversationKey,
    replyTargetId: input.replyTargetId,
    replyThreadId: input.replyThreadId ?? null,
    replyMessageId: input.replyMessageId ?? null,
    text: input.text,
    createdAt: nowIso(),
  });
  if (existing) {
    return "pending";
  }

  const senderLabel = normalizeSenderDisplayName(input.senderId, input.senderName);
  const preview = input.text.replace(/\s+/g, " ").trim().slice(0, 280);
  const notification = createNotification({
    id: randomUUID(),
    type: "channel_permission_request",
    title: `Allow ${input.channelId} sender ${senderLabel}?`,
    body: `Incoming message: ${preview}` + (preview.length >= 280 ? "..." : ""),
    targetUrl: "/channels",
    metadata: {
      connectionId: input.connectionId,
      channelId: input.channelId,
      senderId: input.senderId,
      senderName: input.senderName,
      messagePreview: preview,
    },
  });
  publishNotification(notification);
  return "pending";
}

export function listPendingMessagesForSender(
  connectionId: string,
  senderId: string
): PendingChannelMessage[] {
  return listPendingChannelMessages(connectionId, senderId);
}

export function clearPendingMessagesForSender(connectionId: string, senderId: string): void {
  deletePendingChannelMessagesForSender(connectionId, senderId);
}
