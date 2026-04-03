import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  deleteChannelConnection,
  deleteChannelSenderPermission,
  listChannelSenderPermissions,
  listChannelConnections,
  upsertChannelSenderPermission,
  upsertChannelConnection,
} from "../db/repository.js";
import { getChannelRegistry } from "../channels/registry.js";
import { encryptApiKey } from "../utils/crypto.js";
import { nowIso } from "../utils/time.js";
import { startRunner, stopRunner } from "../channels/runnerManager.js";
import { setupWhatsApp } from "../channels/runners/whatsapp.js";
import { clearPendingMessagesForSender } from "../services/channelAccess.js";
import { processPendingMessagesForSender } from "../services/channelPendingProcessor.js";
import type { ChannelId, ChannelSenderStatus } from "../types.js";

// ─── Token validators ─────────────────────────────────────────────────────────

async function validateTelegramToken(token: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`);
  if (!res.ok) throw new Error("Could not reach Telegram API");
  const data = (await res.json()) as {
    ok: boolean;
    result?: { id: number; first_name: string; username?: string };
  };
  if (!data.ok || !data.result) throw new Error("Invalid Telegram bot token");
  const { id, first_name, username } = data.result;
  return { id: String(id), name: username ? `${first_name} (@${username})` : first_name };
}

async function validateDiscordToken(token: string): Promise<{ id: string; name: string }> {
  const res = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) throw new Error("Invalid Discord bot token");
  const data = (await res.json()) as { id: string; username: string };
  return { id: data.id, name: data.username };
}

async function validateSlackToken(
  botToken: string,
  appToken: string
): Promise<{ id: string; name: string }> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
  });
  const data = (await res.json()) as {
    ok: boolean;
    bot_id?: string;
    team?: string;
    error?: string;
  };
  if (!data.ok) throw new Error(`Invalid Slack bot token: ${data.error ?? "unknown error"}`);
  // Basic check that the app token looks right
  if (!appToken.startsWith("xapp-")) {
    throw new Error("App-level token must start with xapp-");
  }
  return { id: data.bot_id ?? "slack-bot", name: data.team ?? "Slack workspace" };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/channels/registry", async () => getChannelRegistry());

  app.get("/api/channels/accounts", async () => listChannelConnections());

  app.get("/api/channels/senders", async (request) => {
    const { connectionId } = request.query as { connectionId?: string };
    return listChannelSenderPermissions(connectionId);
  });

  app.put("/api/channels/senders", async (request, reply) => {
    const parse = z
      .object({
        connectionId: z.string().min(1),
        channelId: z.enum(["telegram", "whatsapp", "discord", "slack"]),
        senderId: z.string().min(1),
        senderName: z.string().nullable().optional(),
        status: z.enum(["approved", "blocked"]),
      })
      .safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: "Invalid sender permission payload" });

    const updated = upsertChannelSenderPermission({
      connectionId: parse.data.connectionId,
      channelId: parse.data.channelId as ChannelId,
      senderId: parse.data.senderId,
      senderName: parse.data.senderName ?? null,
      status: parse.data.status as ChannelSenderStatus,
    });

    if (updated.status === "approved") {
      void processPendingMessagesForSender(updated.connectionId, updated.senderId);
    } else {
      clearPendingMessagesForSender(updated.connectionId, updated.senderId);
    }

    return updated;
  });

  app.delete("/api/channels/senders", async (request, reply) => {
    const parse = z
      .object({
        connectionId: z.string().min(1),
        senderId: z.string().min(1),
      })
      .safeParse(request.query);
    if (!parse.success) {
      return reply.code(400).send({ error: "connectionId and senderId are required" });
    }

    deleteChannelSenderPermission(parse.data.connectionId, parse.data.senderId);
    return reply.code(204).send();
  });

  // ── Token-based connect (Telegram, Discord, Slack) ───────────────────────
  app.post<{ Params: { channelId: string } }>(
    "/api/channels/:channelId/token",
    async (request, reply) => {
      const { channelId } = request.params;

      const parse = z
        .object({ token: z.string().min(1), token2: z.string().optional() })
        .safeParse(request.body);
      if (!parse.success) return reply.code(400).send({ error: "token required" });

      const { token, token2 } = parse.data;

      let accountId: string;
      let accountName: string;

      try {
        if (channelId === "telegram") {
          const info = await validateTelegramToken(token);
          accountId = info.id;
          accountName = info.name;
        } else if (channelId === "discord") {
          const info = await validateDiscordToken(token);
          accountId = info.id;
          accountName = info.name;
        } else if (channelId === "slack") {
          if (!token2)
            return reply.code(400).send({ error: "App-level token (token2) required for Slack" });
          const info = await validateSlackToken(token, token2);
          accountId = info.id;
          accountName = info.name;
        } else {
          return reply.code(400).send({ error: `Channel "${channelId}" does not use token auth` });
        }
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }

      const now = nowIso();
      const conn = await upsertChannelConnection({
        id: randomUUID(),
        provider: channelId as ChannelId,
        accountId,
        accountName,
        accountEmail: null,
        accountAvatar: null,
        accessToken: encryptApiKey(token),
        refreshToken: token2 ? encryptApiKey(token2) : null,
        tokenExpiresAt: null,
        scopes: [],
        createdAt: now,
        updatedAt: now,
      });

      await startRunner(conn);
      return conn;
    }
  );

  // ── WhatsApp QR SSE stream ────────────────────────────────────────────────
  app.get("/api/channels/whatsapp/qr", async (request, reply) => {
    const connectionId = randomUUID();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    function send(event: string, data: unknown): void {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    try {
      for await (const event of setupWhatsApp(connectionId)) {
        if (event.type === "qr") {
          send("qr", { dataUrl: event.dataUrl });
        } else if (event.type === "connected") {
          const now = nowIso();
          const conn = await upsertChannelConnection({
            id: connectionId,
            provider: "whatsapp",
            accountId: event.accountId,
            accountName: event.accountName,
            accountEmail: null,
            accountAvatar: null,
            accessToken: encryptApiKey(connectionId), // session is file-based, token is a reference
            refreshToken: null,
            tokenExpiresAt: null,
            scopes: [],
            createdAt: now,
            updatedAt: now,
          });

          const runner = (await import("../channels/runnerManager.js")).startRunner;
          await runner(conn);

          send("connected", { connectionId: conn.id, accountName: event.accountName });
          break;
        } else if (event.type === "error") {
          send("error", { message: event.message });
          break;
        }
      }
    } catch (err) {
      send("error", { message: (err as Error).message });
    }

    reply.raw.end();
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/api/channels/accounts/:id", async (request, reply) => {
    await stopRunner(request.params.id);
    deleteChannelConnection(request.params.id);
    return reply.code(204).send();
  });
}
