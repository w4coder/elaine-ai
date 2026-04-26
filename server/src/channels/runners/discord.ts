/**
 * Discord runner — connects to the Discord Gateway via discord.js,
 * listens for messages in channels the bot can read, and replies.
 */

import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { routeMessage } from "../messageRouter.js";
import { formatReplyForChannel } from "../formatReply.js";
import { withTypingIndicator } from "../typing.js";
import type { ChannelConnection, ChannelReplyOptions } from "../../types.js";

export class DiscordRunner {
  private connection: ChannelConnection;
  private client: Client;
  private token: string;

  constructor(connection: ChannelConnection, token: string) {
    this.connection = connection;
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

  async sendMessage(targetId: string, text: string, options?: ChannelReplyOptions): Promise<void> {
    const channel = await this.client.channels.fetch(targetId);
    if (!channel || !("send" in channel) || typeof channel.send !== "function") {
      throw new Error(`Discord channel ${targetId} is not sendable`);
    }

    if (
      options?.replyMessageId &&
      "messages" in channel &&
      channel.messages &&
      typeof channel.messages.fetch === "function"
    ) {
      try {
        const source = await channel.messages.fetch(options.replyMessageId);
        await source.reply(formatReplyForChannel("discord", text));
        return;
      } catch {
        // Fall through to a normal send if the source message is gone.
      }
    }

    await channel.send(formatReplyForChannel("discord", text));
  }

  private async handleMessage(message: import("discord.js").Message): Promise<void> {
    try {
      const isDirect = !message.guildId;
      const isMention =
        !!this.client.user && message.mentions.users.has(this.client.user.id) && !isDirect;
      if (!this.shouldRouteMessage(isDirect, isMention)) {
        return;
      }

      const conversationKey = isDirect
        ? `${this.connection.id}:dm:${message.channelId}`
        : message.channel.isThread()
          ? `${this.connection.id}:thread:${message.channelId}`
          : `${this.connection.id}:channel:${message.channelId}:sender:${message.author.id}`;
      const replyMessageId = !isDirect && this.connection.replyInThread ? message.id : null;
      const typingChannel = message.channel as { sendTyping?: () => Promise<void> };
      const reply = await withTypingIndicator(
        () => typingChannel.sendTyping?.() ?? Promise.resolve(),
        () =>
          routeMessage({
            connectionId: this.connection.id,
            channelId: "discord",
            senderId: message.author.id,
            senderName: message.member?.displayName ?? message.author.username,
            conversationKey,
            replyTargetId: message.channelId,
            replyMessageId,
            text: message.content,
          }),
        8000
      );

      if (reply) {
        await this.sendMessage(message.channelId, reply, { replyMessageId });
      }
    } catch {
      // Ignore routing errors
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
