/**
 * Slack runner — uses @slack/bolt in Socket Mode.
 * Requires a bot token (xoxb-) and an app-level token (xapp-).
 */

import { App } from "@slack/bolt";
import { routeMessage } from "../messageRouter.js";
import { formatReplyForChannel } from "../formatReply.js";
import type { ChannelConnection, ChannelReplyOptions } from "../../types.js";

export class SlackRunner {
  private connection: ChannelConnection;
  private app: App;
  private botUserId: string | null = null;

  constructor(connection: ChannelConnection, botToken: string, appToken: string) {
    this.connection = connection;
    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    this.app.message(async ({ message }) => {
      if (message.subtype) return; // ignore edits, deletes, etc.
      const msg = message as {
        text?: string;
        user?: string;
        ts?: string;
        thread_ts?: string;
        channel?: string;
        channel_type?: string;
      };
      if (!msg.text || !msg.user) return;
      const replyTargetId = msg.channel ?? msg.user;
      const isDirect = msg.channel_type === "im";
      const isMention = this.botUserId ? msg.text.includes(`<@${this.botUserId}>`) : false;

      if (!this.shouldRouteMessage(isDirect, isMention)) {
        return;
      }

      const threadId =
        !isDirect && this.connection.replyInThread ? (msg.thread_ts ?? msg.ts) : null;
      const conversationKey = isDirect
        ? `${this.connection.id}:dm:${replyTargetId}`
        : threadId
          ? `${this.connection.id}:channel:${replyTargetId}:thread:${threadId}`
          : `${this.connection.id}:channel:${replyTargetId}:sender:${msg.user}`;

      try {
        const reply = await routeMessage({
          connectionId: this.connection.id,
          channelId: "slack",
          senderId: msg.user,
          senderName: null,
          conversationKey,
          replyTargetId,
          replyThreadId: threadId,
          replyMessageId: msg.ts ?? null,
          text: msg.text,
        });

        if (reply) {
          await this.sendMessage(replyTargetId, reply, {
            threadId,
            replyMessageId: msg.ts ?? null,
          });
        }
      } catch {
        // Ignore routing errors
      }
    });
  }

  async start(): Promise<void> {
    await this.app.start();
    try {
      const auth = await this.app.client.auth.test();
      this.botUserId = auth.user_id ?? null;
    } catch {
      this.botUserId = null;
    }
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  async sendMessage(targetId: string, text: string, options?: ChannelReplyOptions): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: targetId,
      text: formatReplyForChannel("slack", text),
      thread_ts: options?.threadId ?? undefined,
    });
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
