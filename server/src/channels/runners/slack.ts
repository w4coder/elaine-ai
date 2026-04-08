/**
 * Slack runner — uses @slack/bolt in Socket Mode.
 * Requires a bot token (xoxb-) and an app-level token (xapp-).
 */

import { App } from "@slack/bolt";
import { routeMessage } from "../messageRouter.js";
import { formatReplyForChannel } from "../formatReply.js";

export class SlackRunner {
  private connectionId: string;
  private app: App;

  constructor(connectionId: string, botToken: string, appToken: string) {
    this.connectionId = connectionId;
    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    this.app.message(async ({ message }) => {
      if (message.subtype) return; // ignore edits, deletes, etc.
      const msg = message as { text?: string; user?: string };
      if (!msg.text || !msg.user) return;
      const replyTargetId = (message as { channel?: string }).channel ?? msg.user;

      try {
        const reply = await routeMessage({
          connectionId: this.connectionId,
          channelId: "slack",
          senderId: msg.user,
          senderName: null,
          replyTargetId,
          text: msg.text,
        });

        if (reply) {
          await this.sendMessage(replyTargetId, reply);
        }
      } catch {
        // Ignore routing errors
      }
    });
  }

  async start(): Promise<void> {
    await this.app.start();
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  async sendMessage(targetId: string, text: string): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: targetId,
      text: formatReplyForChannel("slack", text),
    });
  }
}
