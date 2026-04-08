/**
 * Discord runner — connects to the Discord Gateway via discord.js,
 * listens for messages in channels the bot can read, and replies.
 */

import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { routeMessage } from "../messageRouter.js";
import { formatReplyForChannel } from "../formatReply.js";
import { withTypingIndicator } from "../typing.js";

export class DiscordRunner {
  private connectionId: string;
  private client: Client;
  private token: string;

  constructor(connectionId: string, token: string) {
    this.connectionId = connectionId;
    this.token = token;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.client.on(Events.MessageCreate, (message) => {
      if (message.author.bot) return;
      void this.handleMessage(message);
    });
  }

  start(): void {
    void this.client.login(this.token);
  }

  stop(): void {
    void this.client.destroy();
  }

  async sendMessage(targetId: string, text: string): Promise<void> {
    const channel = await this.client.channels.fetch(targetId);
    if (!channel || !("send" in channel) || typeof channel.send !== "function") {
      throw new Error(`Discord channel ${targetId} is not sendable`);
    }
    await channel.send(formatReplyForChannel("discord", text));
  }

  private async handleMessage(message: import("discord.js").Message): Promise<void> {
    try {
      const typingChannel = message.channel as { sendTyping?: () => Promise<void> };
      const reply = await withTypingIndicator(
        () => typingChannel.sendTyping?.() ?? Promise.resolve(),
        () =>
          routeMessage({
            connectionId: this.connectionId,
            channelId: "discord",
            senderId: message.author.id,
            senderName: message.author.displayName ?? message.author.username,
            replyTargetId: message.channelId,
            text: message.content,
          }),
        8000
      );

      if (reply) {
        await this.sendMessage(message.channelId, reply);
      }
    } catch {
      // Ignore routing errors
    }
  }
}
