/**
 * runnerManager — lifecycle manager for all active channel runners.
 *
 * On server boot call bootAll() to start a runner for each stored connection.
 * Call start/stop when connections are added or removed.
 */

import { listChannelConnections, getChannelConnectionToken } from "../db/repository.js";
import { TelegramRunner } from "./runners/telegram.js";
import { DiscordRunner } from "./runners/discord.js";
import { SlackRunner } from "./runners/slack.js";
import { WhatsAppRunner } from "./runners/whatsapp.js";
import type { ChannelConnection, ChannelId, ChannelReplyOptions } from "../types.js";

type AnyRunner = {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  sendMessage?(targetId: string, text: string, options?: ChannelReplyOptions): Promise<void>;
};

const runners = new Map<string, AnyRunner>();

export async function startRunner(connection: ChannelConnection): Promise<void> {
  if (runners.has(connection.id)) return;

  const tokenData = getChannelConnectionToken(connection.id);
  if (!tokenData) return;

  const token = tokenData.accessToken; // already decrypted by getChannelConnectionToken

  let runner: AnyRunner | null = null;

  switch (connection.provider as ChannelId) {
    case "telegram":
      runner = new TelegramRunner(connection, token);
      break;

    case "discord":
      runner = new DiscordRunner(connection, token);
      break;

    case "slack": {
      const appToken = tokenData.refreshToken;
      if (!appToken) {
        console.warn(`[runnerManager] Slack connection ${connection.id} missing app-level token`);
        return;
      }
      runner = new SlackRunner(connection, token, appToken);
      break;
    }

    case "whatsapp":
      runner = new WhatsAppRunner(connection);
      break;

    default:
      return;
  }

  runners.set(connection.id, runner);
  try {
    await runner.start();
  } catch (err) {
    console.error(`[runnerManager] Failed to start ${connection.provider} runner:`, err);
    runners.delete(connection.id);
  }
}

export async function restartRunner(connection: ChannelConnection): Promise<void> {
  await stopRunner(connection.id);
  await startRunner(connection);
}

export async function stopRunner(connectionId: string): Promise<void> {
  const runner = runners.get(connectionId);
  if (!runner) return;
  runners.delete(connectionId);
  try {
    await runner.stop();
  } catch {
    // Ignore stop errors
  }
}

export async function bootAll(): Promise<void> {
  const connections = listChannelConnections();
  for (const conn of connections) {
    await startRunner(conn);
  }
}

export async function sendChannelMessage(
  connectionId: string,
  targetId: string,
  text: string,
  options?: ChannelReplyOptions
): Promise<void> {
  const runner = runners.get(connectionId);
  if (!runner?.sendMessage) {
    throw new Error(`Runner for connection ${connectionId} cannot send messages`);
  }
  await runner.sendMessage(targetId, text, options);
}
