/**
 * Telegram runner — long-polls getUpdates and routes each private/group message
 * through the AI pipeline, then replies via sendMessage.
 */

import { routeMessage } from "../messageRouter.js";
import { formatReplyForChannel } from "../formatReply.js";
import { withTypingIndicator } from "../typing.js";

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
  private connectionId: string;
  private token: string;
  private offset = 0;
  private stopped = false;
  private abortController = new AbortController();

  constructor(connectionId: string, token: string) {
    this.connectionId = connectionId;
    this.token = token;
  }

  start(): void {
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    this.abortController.abort();
  }

  async sendMessage(targetId: string, text: string): Promise<void> {
    await this.api("sendMessage", {
      chat_id: targetId,
      text: formatReplyForChannel("telegram", text),
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

          void this.handleMessage(chatId, senderId, senderName, msg.text);
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
    text: string
  ): Promise<void> {
    try {
      const reply = await withTypingIndicator(
        () => this.api("sendChatAction", { chat_id: chatId, action: "typing" }).then(() => {}),
        () =>
          routeMessage({
            connectionId: this.connectionId,
            channelId: "telegram",
            senderId,
            senderName,
            replyTargetId: chatId,
            text,
          }),
        4000
      );

      if (reply) {
        await this.sendMessage(chatId, reply);
      }
    } catch (err) {
      console.error("[TelegramRunner] handleMessage error:", err);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
