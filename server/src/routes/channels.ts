import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  deleteChannelConnectionWithRelatedData,
  deleteChannelCapabilityGrant,
  deleteChannelCapabilityGrantsForConnection,
  deleteChannelCapabilityGrantsForConversation,
  deleteChannelSenderPermission,
  getChannelConnection,
  listChannelCapabilityGrants,
  listChannelSenderPermissions,
  listChannelConnections,
  updateChannelConnectionSettings,
  upsertChannelSenderPermission,
  upsertChannelConnection,
} from "../db/repository.js";
import { getChannelRegistry } from "../channels/registry.js";
import { encryptApiKey } from "../utils/crypto.js";
import { nowIso } from "../utils/time.js";
import { restartRunner, stopRunner } from "../channels/runnerManager.js";
import {
  deleteWhatsAppSession,
  moveWhatsAppSession,
  setupWhatsApp,
} from "../channels/runners/whatsapp.js";
import { clearPendingMessagesForSender } from "../services/channelAccess.js";
import {
  markChannelCapabilityNotificationStatus,
  saveChannelCapabilityDecision,
} from "../services/channelCapabilityPermissions.js";
import {
  denyPendingCapabilityRequestsForConversation,
  processPendingCapabilityRequestsForConversation,
} from "../services/channelCapabilityPendingProcessor.js";
import { processPendingMessagesForSender } from "../services/channelPendingProcessor.js";
import type { ChannelId, ChannelRoutingMode, ChannelSenderStatus } from "../types.js";

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

function getDefaultChannelRoutingSettings(_provider: ChannelId): {
  routingMode: ChannelRoutingMode;
  replyInThread: boolean;
} {
  return {
    routingMode: "mentions",
    replyInThread: true,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/channels/registry", async () => getChannelRegistry());

  app.get("/api/channels/accounts", async () => listChannelConnections());

  app.patch<{ Params: { id: string } }>("/api/channels/accounts/:id", async (request, reply) => {
    const parse = z
      .object({
        routingMode: z.enum(["direct", "mentions", "all"]).optional(),
        replyInThread: z.boolean().optional(),
      })
      .refine((data) => data.routingMode !== undefined || data.replyInThread !== undefined, {
        message: "At least one channel setting must be provided",
      })
      .safeParse(request.body);

    if (!parse.success) {
      return reply.code(400).send({ error: "Invalid channel settings payload" });
    }

    const updated = updateChannelConnectionSettings(request.params.id, parse.data);
    if (!updated) {
      return reply.code(404).send({ error: "Channel connection not found" });
    }

    await restartRunner(updated);
    return updated;
  });

  app.get("/api/channels/senders", async (request) => {
    const { connectionId } = request.query as { connectionId?: string };
    return listChannelSenderPermissions(connectionId);
  });

  app.get("/api/channels/capabilities", async (request, reply) => {
    const parse = z
      .object({
        connectionId: z.string().min(1).optional(),
      })
      .safeParse(request.query);

    if (!parse.success) {
      return reply.code(400).send({ error: "Invalid channel capabilities query" });
    }

    return listChannelCapabilityGrants(parse.data.connectionId);
  });

  app.post("/api/channels/capabilities", async (request, reply) => {
    const parse = z
      .object({
        connectionId: z.string().min(1),
        notificationId: z.string().min(1).optional(),
        scopeKey: z.string().min(1).optional(),
        conversationKey: z.string().min(1),
        capability: z.string().min(1),
        type: z.enum(["once", "chat", "deny"]),
      })
      .safeParse(request.body);

    if (!parse.success) {
      return reply.code(400).send({ error: "Invalid channel capability payload" });
    }

    const connection = getChannelConnection(parse.data.connectionId);
    if (!connection) {
      return reply.code(404).send({ error: "Channel connection not found" });
    }

    const scopeKey = parse.data.scopeKey ?? parse.data.conversationKey;

    saveChannelCapabilityDecision({
      connectionId: parse.data.connectionId,
      conversationKey: scopeKey,
      capability: parse.data.capability,
      type: parse.data.type,
    });

    const processingNotification = markChannelCapabilityNotificationStatus({
      notificationId: parse.data.notificationId,
      connectionId: parse.data.connectionId,
      scopeKey,
      capability: parse.data.capability,
      status: parse.data.type === "deny" ? "denied" : "processing",
      resolution: parse.data.type,
    });

    if (parse.data.type === "deny") {
      await denyPendingCapabilityRequestsForConversation({
        connectionId: parse.data.connectionId,
        scopeKey,
        capability: parse.data.capability,
      });
    } else {
      await processPendingCapabilityRequestsForConversation({
        connectionId: parse.data.connectionId,
        scopeKey,
        capability: parse.data.capability,
        limit: parse.data.type === "once" ? 1 : undefined,
      });

      markChannelCapabilityNotificationStatus({
        notificationId: parse.data.notificationId,
        connectionId: parse.data.connectionId,
        scopeKey,
        capability: parse.data.capability,
        status: "completed",
        resolution: parse.data.type,
      });
    }

    return {
      ok: true,
      notification:
        parse.data.type === "deny"
          ? markChannelCapabilityNotificationStatus({
              notificationId: parse.data.notificationId,
              connectionId: parse.data.connectionId,
              scopeKey,
              capability: parse.data.capability,
              status: "denied",
              resolution: parse.data.type,
            })
          : (markChannelCapabilityNotificationStatus({
              notificationId: parse.data.notificationId,
              connectionId: parse.data.connectionId,
              scopeKey,
              capability: parse.data.capability,
              status: "completed",
              resolution: parse.data.type,
            }) ?? processingNotification),
    };
  });

  app.delete("/api/channels/capabilities", async (request, reply) => {
    const parse = z
      .object({
        connectionId: z.string().min(1),
        scopeKey: z.string().min(1).optional(),
        conversationKey: z.string().min(1).optional(),
        capability: z.string().min(1).optional(),
      })
      .superRefine((data, ctx) => {
        if (data.capability && !data.conversationKey && !data.scopeKey) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "scopeKey or conversationKey is required when capability is provided",
            path: ["scopeKey"],
          });
        }
      })
      .safeParse(request.query);

    if (!parse.success) {
      return reply.code(400).send({ error: "Invalid channel capability revoke query" });
    }

    const connection = getChannelConnection(parse.data.connectionId);
    if (!connection) {
      return reply.code(404).send({ error: "Channel connection not found" });
    }

    const scopeKey = parse.data.scopeKey ?? parse.data.conversationKey;

    if (scopeKey && parse.data.capability) {
      deleteChannelCapabilityGrant(parse.data.connectionId, scopeKey, parse.data.capability);
    } else if (scopeKey) {
      deleteChannelCapabilityGrantsForConversation(parse.data.connectionId, scopeKey);
    } else {
      deleteChannelCapabilityGrantsForConnection(parse.data.connectionId);
    }

    return reply.code(204).send();
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

    const connection = getChannelConnection(parse.data.connectionId);
    if (!connection) {
      return reply.code(404).send({ error: "Channel connection not found" });
    }
    if (connection.provider !== parse.data.channelId) {
      return reply.code(400).send({ error: "channelId does not match the connection provider" });
    }

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
      const defaults = getDefaultChannelRoutingSettings(channelId as ChannelId);
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
        routingMode: defaults.routingMode,
        replyInThread: defaults.replyInThread,
        scopes: [],
        createdAt: now,
        updatedAt: now,
      });

      await restartRunner(conn);
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
          const defaults = getDefaultChannelRoutingSettings("whatsapp");
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
            routingMode: defaults.routingMode,
            replyInThread: defaults.replyInThread,
            scopes: [],
            createdAt: now,
            updatedAt: now,
          });

          if (conn.id !== connectionId) {
            await stopRunner(conn.id);
            moveWhatsAppSession(connectionId, conn.id);
          }
          await restartRunner(conn);

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
    deleteChannelConnectionWithRelatedData(request.params.id);
    deleteWhatsAppSession(request.params.id);
    return reply.code(204).send();
  });
}
