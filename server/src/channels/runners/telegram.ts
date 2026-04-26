/**
 * Telegram runner — long-polls getUpdates and routes each private/group message
 * through the AI pipeline, then replies via sendMessage.
 */

import { routeMessage } from "../messageRouter.js";
import { formatReplyForChannel } from "../formatReply.js";
import { withTypingIndicator } from "../typing.js";
import type { ChannelConnection, ChannelReplyOptions } from "../../types.js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number };
    text?: string;
  };
}

export class TelegramRunner {
  private connection: ChannelConnection;
  private token: string;
  private offset = 0;
  private stopped = false;
  private abortController = new AbortController();
  private botUsername: string | null;

  constructor(connection: ChannelConnection, token: string) {
    this.connection = connection;
    this.token = token;
    this.botUsername = extractTelegramUsername(connection.accountName);
  }

  start(): void {
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    this.abortController.abort();
  }

  async sendMessage(targetId: string, text: string, options?: ChannelReplyOptions): Promise<void> {
    await this.api("sendMessage", {
      chat_id: targetId,
      text: formatReplyForChannel("telegram", text),
      reply_to_message_id: options?.replyMessageId ? Number(options.replyMessageId) : undefined,
    });
  }

  private api(method: string, body?: Record<string, unknown>): Promise<Response> {
    return fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: this.abortController.signal,
    });
  }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      try {
        const res = await this.api("getUpdates", {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ["message"],
        });

        if (!res.ok) {
          await sleep(5000);
          continue;
        }

        const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
        if (!data.ok) {
          await sleep(5000);
          continue;
        }

        for (const update of data.result) {
          this.offset = update.update_id + 1;
          const msg = update.message;
          if (!msg?.text || !msg.from) continue;

          const senderId = String(msg.from.id);
          const chatId = String(msg.chat.id);
          const senderName = msg.from.first_name ?? null;

          void this.handleMessage(chatId, senderId, senderName, msg.text, msg.message_id);
        }
      } catch (err) {
        if (this.stopped) break;
        await sleep(3000);
      }
    }
  }

  private async handleMessage(
    chatId: string,
    senderId: string,
    senderName: string | null,
    text: string,
    messageId: number
  ): Promise<void> {
    try {
      const isDirect = chatId === senderId;
      const isMention = this.botUsername
        ? text.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`)
        : false;
      if (!this.shouldRouteMessage(isDirect, isMention)) {
        return;
      }

      const conversationKey = isDirect
        ? `${this.connection.id}:dm:${chatId}`
        : `${this.connection.id}:chat:${chatId}:sender:${senderId}`;
      const replyMessageId = !isDirect && this.connection.replyInThread ? String(messageId) : null;
      const reply = await withTypingIndicator(
        () => this.api("sendChatAction", { chat_id: chatId, action: "typing" }).then(() => {}),
        () =>
          routeMessage({
            connectionId: this.connection.id,
            channelId: "telegram",
            senderId,
            senderName,
            conversationKey,
            replyTargetId: chatId,
            replyMessageId,
            text,
          }),
        4000
      );

      if (reply) {
        await this.sendMessage(chatId, reply, { replyMessageId });
      }
    } catch (err) {
      console.error("[TelegramRunner] handleMessage error:", err);
    }
  }

  private shouldRouteMessage(isDirect: boolean, isMention: boolean): boolean {
    if (isDirect) {
      return true;
    }

    switch (this.connection.routingMode) {
      case "all":
        return true;
      case "mentions":
        return isMention;
      case "direct":
      default:
        return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractTelegramUsername(accountName: string | null): string | null {
  if (!accountName) {
    return null;
  }

  const parenMatch = accountName.match(/\(@([^)]+)\)/);
  if (parenMatch?.[1]) {
    return parenMatch[1];
  }

  const inlineMatch = accountName.match(/@([A-Za-z0-9_]+)/);
  return inlineMatch?.[1] ?? null;
}
