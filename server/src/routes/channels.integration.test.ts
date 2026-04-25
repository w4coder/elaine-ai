import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "elaine-channels-test-"));
process.env.DATABASE_PATH = join(tmpDir, "test.db");
process.env.ELAINE_SECRET_KEY = "test-key-not-for-production-use";

const {
  createNotification,
  getChannelCapabilityGrant,
  createPendingChannelMessage,
  getChannelConnection,
  getChannelSenderPermission,
  listChannelCapabilityGrants,
  listNotifications,
  listPendingChannelMessages,
  upsertChannelCapabilityGrant,
  upsertChannelConnection,
  upsertChannelSenderPermission,
} = await import("../db/repository.js");

const { db } = await import("../db/database.js");
const Fastify = (await import("fastify")).default;
const { channelRoutes } = await import("./channels.js");

const app = Fastify({ logger: false });
await app.register(channelRoutes);
await app.ready();

after(async () => {
  await app.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeConnection(overrides: Partial<Parameters<typeof upsertChannelConnection>[0]> = {}) {
  const now = new Date().toISOString();
  return upsertChannelConnection({
    id: overrides.id ?? `conn-${Date.now()}-${Math.random()}`,
    provider: overrides.provider ?? "telegram",
    accountId: overrides.accountId ?? `acct-${Date.now()}-${Math.random()}`,
    accountName: overrides.accountName ?? "Test account",
    accountEmail: overrides.accountEmail ?? null,
    accountAvatar: overrides.accountAvatar ?? null,
    accessToken: overrides.accessToken ?? "token",
    refreshToken: overrides.refreshToken ?? null,
    tokenExpiresAt: overrides.tokenExpiresAt ?? null,
    routingMode: overrides.routingMode ?? "direct",
    replyInThread: overrides.replyInThread ?? true,
    scopes: overrides.scopes ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  });
}

describe("PUT /api/channels/senders", () => {
  test("returns 404 when the connection does not exist", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/channels/senders",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        connectionId: "missing-connection",
        channelId: "telegram",
        senderId: "sender-1",
        senderName: "Alice",
        status: "blocked",
      }),
    });

    assert.equal(response.statusCode, 404);
    assert.equal(getChannelSenderPermission("missing-connection", "sender-1"), null);
  });

  test("returns 400 when the sender channel does not match the connection provider", async () => {
    const connection = makeConnection({ provider: "telegram" });

    const response = await app.inject({
      method: "PUT",
      url: "/api/channels/senders",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        connectionId: connection.id,
        channelId: "discord",
        senderId: "sender-2",
        senderName: "Bob",
        status: "blocked",
      }),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(getChannelSenderPermission(connection.id, "sender-2"), null);
  });
});

describe("PATCH /api/channels/accounts/:id", () => {
  test("updates routing settings for an existing connection", async () => {
    const connection = makeConnection({
      id: "conn-routing",
      provider: "whatsapp",
      routingMode: "direct",
      replyInThread: true,
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/channels/accounts/${connection.id}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        routingMode: "all",
        replyInThread: false,
      }),
    });

    assert.equal(response.statusCode, 200);
    const updated = getChannelConnection(connection.id);
    assert.equal(updated?.routingMode, "all");
    assert.equal(updated?.replyInThread, false);
  });
});

describe("POST /api/channels/capabilities", () => {
  test("stores a channel capability decision", async () => {
    const connection = makeConnection({
      id: "conn-capability",
      provider: "telegram",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/channels/capabilities",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        connectionId: connection.id,
        scopeKey: `${connection.id}:target:-100123`,
        conversationKey: `${connection.id}:chat:1:sender:2`,
        capability: "network",
        type: "chat",
      }),
    });

    assert.equal(response.statusCode, 200);
    const grant = getChannelCapabilityGrant(
      connection.id,
      `${connection.id}:target:-100123`,
      "network"
    );
    assert.equal(grant?.decision, "chat");
  });
});

describe("GET /api/channels/capabilities", () => {
  test("lists stored channel capability grants", async () => {
    const connection = makeConnection({
      id: "conn-capability-list",
      provider: "telegram",
    });

    upsertChannelCapabilityGrant({
      connectionId: connection.id,
      conversationKey: `${connection.id}:chat:1`,
      capability: "network",
      decision: "chat",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/channels/capabilities?connectionId=${encodeURIComponent(connection.id)}`,
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json() as Array<{ capability: string; conversationKey: string }>;
    assert.equal(payload.length, 1);
    assert.equal(payload[0]?.capability, "network");
    assert.equal(payload[0]?.conversationKey, `${connection.id}:chat:1`);
  });
});

describe("DELETE /api/channels/capabilities", () => {
  test("revokes a single capability grant", async () => {
    const connection = makeConnection({
      id: "conn-capability-delete-one",
      provider: "telegram",
    });

    upsertChannelCapabilityGrant({
      connectionId: connection.id,
      conversationKey: `${connection.id}:chat:1`,
      capability: "network",
      decision: "chat",
    });

    const response = await app.inject({
      method: "DELETE",
      url:
        "/api/channels/capabilities?" +
        new URLSearchParams({
          connectionId: connection.id,
          conversationKey: `${connection.id}:chat:1`,
          capability: "network",
        }).toString(),
    });

    assert.equal(response.statusCode, 204);
    assert.equal(
      getChannelCapabilityGrant(connection.id, `${connection.id}:chat:1`, "network"),
      null
    );
  });

  test("revokes every capability grant for one chat", async () => {
    const connection = makeConnection({
      id: "conn-capability-delete-chat",
      provider: "telegram",
    });

    upsertChannelCapabilityGrant({
      connectionId: connection.id,
      conversationKey: `${connection.id}:chat:2`,
      capability: "network",
      decision: "chat",
    });
    upsertChannelCapabilityGrant({
      connectionId: connection.id,
      conversationKey: `${connection.id}:chat:2`,
      capability: "filesystem_read",
      decision: "chat",
    });
    upsertChannelCapabilityGrant({
      connectionId: connection.id,
      conversationKey: `${connection.id}:chat:3`,
      capability: "shell",
      decision: "chat",
    });

    const response = await app.inject({
      method: "DELETE",
      url:
        "/api/channels/capabilities?" +
        new URLSearchParams({
          connectionId: connection.id,
          conversationKey: `${connection.id}:chat:2`,
        }).toString(),
    });

    assert.equal(response.statusCode, 204);
    assert.equal(
      listChannelCapabilityGrants(connection.id).filter(
        (grant) => grant.conversationKey === `${connection.id}:chat:2`
      ).length,
      0
    );
    assert.ok(getChannelCapabilityGrant(connection.id, `${connection.id}:chat:3`, "shell"));
  });

  test("revokes every capability grant for one connection", async () => {
    const connection = makeConnection({
      id: "conn-capability-delete-connection",
      provider: "telegram",
    });

    upsertChannelCapabilityGrant({
      connectionId: connection.id,
      conversationKey: `${connection.id}:chat:4`,
      capability: "network",
      decision: "chat",
    });
    upsertChannelCapabilityGrant({
      connectionId: connection.id,
      conversationKey: `${connection.id}:chat:5`,
      capability: "filesystem_read",
      decision: "chat",
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/channels/capabilities?connectionId=${encodeURIComponent(connection.id)}`,
    });

    assert.equal(response.statusCode, 204);
    assert.deepEqual(listChannelCapabilityGrants(connection.id), []);
  });
});

describe("DELETE /api/channels/accounts/:id", () => {
  test("removes channel permissions, pending messages, notifications, and conversation links", async () => {
    const connection = makeConnection({ id: "conn-cleanup", provider: "telegram" });

    upsertChannelSenderPermission({
      connectionId: connection.id,
      channelId: "telegram",
      senderId: "sender-3",
      senderName: "Carol",
      status: "approved",
    });

    createPendingChannelMessage({
      id: "pending-1",
      connectionId: connection.id,
      channelId: "telegram",
      senderId: "sender-3",
      senderName: "Carol",
      conversationKey: `${connection.id}:sender-3`,
      replyTargetId: "chat-1",
      replyThreadId: null,
      replyMessageId: null,
      text: "hello",
      createdAt: new Date().toISOString(),
    });

    const notification = createNotification({
      id: "notif-cleanup",
      type: "channel_permission_request",
      title: "Allow Carol?",
      metadata: {
        connectionId: connection.id,
        channelId: "telegram",
        senderId: "sender-3",
      },
    });

    const capabilityNotification = createNotification({
      id: "notif-capability-cleanup",
      type: "channel_capability_request",
      title: "Allow network?",
      metadata: {
        connectionId: connection.id,
        conversationKey: `${connection.id}:sender-3`,
        capability: "network",
      },
    });

    upsertChannelCapabilityGrant({
      connectionId: connection.id,
      conversationKey: `${connection.id}:sender-3`,
      capability: "network",
      decision: "chat",
    });

    db.prepare(
      "INSERT INTO channel_conversations (channel_key, conversation_id) VALUES (?, ?)"
    ).run(`${connection.id}:sender-3`, "conversation-1");

    assert.ok(getChannelConnection(connection.id) !== null);
    assert.ok(getChannelSenderPermission(connection.id, "sender-3") !== null);
    assert.equal(listPendingChannelMessages(connection.id).length, 1);
    assert.ok(listNotifications({ limit: 100 }).some((entry) => entry.id === notification.id));
    assert.ok(
      listNotifications({ limit: 100 }).some((entry) => entry.id === capabilityNotification.id)
    );
    assert.ok(getChannelCapabilityGrant(connection.id, `${connection.id}:sender-3`, "network"));

    const response = await app.inject({
      method: "DELETE",
      url: `/api/channels/accounts/${connection.id}`,
    });

    assert.equal(response.statusCode, 204);
    assert.equal(getChannelConnection(connection.id), null);
    assert.equal(getChannelSenderPermission(connection.id, "sender-3"), null);
    assert.deepEqual(listPendingChannelMessages(connection.id), []);
    assert.ok(!listNotifications({ limit: 100 }).some((entry) => entry.id === notification.id));
    assert.ok(
      !listNotifications({ limit: 100 }).some((entry) => entry.id === capabilityNotification.id)
    );
    assert.equal(
      getChannelCapabilityGrant(connection.id, `${connection.id}:sender-3`, "network"),
      null
    );

    const row = db
      .prepare("SELECT COUNT(*) as count FROM channel_conversations WHERE channel_key LIKE ?")
      .get(`${connection.id}:%`) as { count: number };
    assert.equal(row.count, 0);
  });
});
