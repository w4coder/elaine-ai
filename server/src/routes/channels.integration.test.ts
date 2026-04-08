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
  createPendingChannelMessage,
  getChannelConnection,
  getChannelSenderPermission,
  listNotifications,
  listPendingChannelMessages,
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

function makeConnection(
  overrides: Partial<Parameters<typeof upsertChannelConnection>[0]> = {}
) {
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
      replyTargetId: "chat-1",
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

    db.prepare("INSERT INTO channel_conversations (channel_key, conversation_id) VALUES (?, ?)")
      .run(`${connection.id}:sender-3`, "conversation-1");

    assert.ok(getChannelConnection(connection.id) !== null);
    assert.ok(getChannelSenderPermission(connection.id, "sender-3") !== null);
    assert.equal(listPendingChannelMessages(connection.id).length, 1);
    assert.ok(listNotifications({ limit: 100 }).some((entry) => entry.id === notification.id));

    const response = await app.inject({
      method: "DELETE",
      url: `/api/channels/accounts/${connection.id}`,
    });

    assert.equal(response.statusCode, 204);
    assert.equal(getChannelConnection(connection.id), null);
    assert.equal(getChannelSenderPermission(connection.id, "sender-3"), null);
    assert.deepEqual(listPendingChannelMessages(connection.id), []);
    assert.ok(!listNotifications({ limit: 100 }).some((entry) => entry.id === notification.id));

    const row = db
      .prepare("SELECT COUNT(*) as count FROM channel_conversations WHERE channel_key LIKE ?")
      .get(`${connection.id}:%`) as { count: number };
    assert.equal(row.count, 0);
  });
});
