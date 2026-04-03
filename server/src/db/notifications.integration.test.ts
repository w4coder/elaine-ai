/**
 * Integration tests for notification read/unread persistence.
 *
 * Tests cover:
 *  - Repository layer: createNotification, markNotificationRead,
 *    markAllNotificationsRead, getUnreadNotificationCount, deleteNotification,
 *    clearAllNotifications, listNotifications
 *  - HTTP layer: PATCH /api/notifications/:id correctly persists read status
 *    through the full Fastify → repository → SQLite path
 */
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Temp database — must be set before any server module is imported ───────────
const tmpDir = mkdtempSync(join(tmpdir(), "elaine-notifications-test-"));
process.env.DATABASE_PATH = join(tmpDir, "test.db");
process.env.ELAINE_SECRET_KEY = "test-key-not-for-production-use";

const {
  createNotification,
  getNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  deleteNotification,
  clearAllNotifications,
} = await import("./repository.js");

const { db } = await import("./database.js");

// ── Fastify app for HTTP-layer tests ──────────────────────────────────────────
import Fastify from "fastify";
import { notificationRoutes } from "../routes/notifications.js";

const app = Fastify({ logger: false });
await app.register(notificationRoutes);
await app.ready();

// ── Cleanup ───────────────────────────────────────────────────────────────────
after(async () => {
  await app.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
let counter = 0;
function makeNotification(overrides: { type?: string; title?: string; body?: string } = {}) {
  counter++;
  return createNotification({
    id: `notif-${counter}-${Date.now()}`,
    type: overrides.type ?? "schedule_completed",
    title: overrides.title ?? `Test notification ${counter}`,
    body: overrides.body ?? null,
  });
}

// ── Repository layer ──────────────────────────────────────────────────────────

describe("createNotification", () => {
  test("creates a notification with read=false by default", () => {
    const n = makeNotification({ title: "New alert" });

    assert.equal(n.title, "New alert");
    assert.equal(n.read, false);
    assert.ok(typeof n.id === "string" && n.id.length > 0);
    assert.ok(typeof n.createdAt === "string");
  });
});

describe("getNotification", () => {
  test("returns the notification by id", () => {
    const n = makeNotification({ title: "Fetchable" });
    const fetched = getNotification(n.id);

    assert.ok(fetched !== null);
    assert.equal(fetched.id, n.id);
    assert.equal(fetched.title, "Fetchable");
    assert.equal(fetched.read, false);
  });

  test("returns null for unknown id", () => {
    assert.equal(getNotification("does-not-exist"), null);
  });
});

describe("markNotificationRead — persistence", () => {
  test("persists read=true to the database", () => {
    const n = makeNotification();
    assert.equal(n.read, false);

    markNotificationRead(n.id, true);

    const after = getNotification(n.id);
    assert.ok(after !== null);
    assert.equal(
      after.read,
      true,
      "read status must be true in DB after markNotificationRead(true)"
    );
  });

  test("persists read=false (mark unread) to the database", () => {
    const n = makeNotification();
    markNotificationRead(n.id, true);
    assert.equal(getNotification(n.id)?.read, true);

    markNotificationRead(n.id, false);

    const after = getNotification(n.id);
    assert.ok(after !== null);
    assert.equal(
      after.read,
      false,
      "read status must be false in DB after markNotificationRead(false)"
    );
  });

  test("persists across a fresh read — simulates page refresh", () => {
    const n = makeNotification({ title: "Refresh test" });

    // Mark as read
    markNotificationRead(n.id, true);

    // Simulate a "refresh": re-fetch from DB (as init() would do)
    const refreshed = listNotifications({ limit: 200 });
    const found = refreshed.find((x) => x.id === n.id);

    assert.ok(found !== undefined, "notification must appear in list after refresh");
    assert.equal(found.read, true, "notification must still be read after re-fetching from DB");
  });

  test("marks only the targeted notification as read", () => {
    const a = makeNotification({ title: "Mark me" });
    const b = makeNotification({ title: "Leave me" });

    markNotificationRead(a.id, true);

    assert.equal(getNotification(a.id)?.read, true);
    assert.equal(getNotification(b.id)?.read, false, "other notifications must not be affected");
  });
});

describe("markAllNotificationsRead", () => {
  test("sets every notification to read=true", () => {
    const a = makeNotification();
    const b = makeNotification();
    const c = makeNotification();

    // Ensure at least one is already read (idempotency check)
    markNotificationRead(a.id, true);

    markAllNotificationsRead();

    assert.equal(getNotification(a.id)?.read, true);
    assert.equal(getNotification(b.id)?.read, true);
    assert.equal(getNotification(c.id)?.read, true);
  });
});

describe("getUnreadNotificationCount", () => {
  test("returns zero when all notifications are read", () => {
    // Clear slate for this test
    clearAllNotifications();
    const a = makeNotification();
    const b = makeNotification();
    markNotificationRead(a.id, true);
    markNotificationRead(b.id, true);

    assert.equal(getUnreadNotificationCount(), 0);
  });

  test("decrements when a notification is marked read", () => {
    clearAllNotifications();
    const a = makeNotification();
    const b = makeNotification();
    void b; // keep b unread

    const before = getUnreadNotificationCount();
    assert.equal(before, 2);

    markNotificationRead(a.id, true);

    assert.equal(getUnreadNotificationCount(), 1);
  });

  test("increments when a notification is marked unread", () => {
    clearAllNotifications();
    const a = makeNotification();
    markNotificationRead(a.id, true);
    assert.equal(getUnreadNotificationCount(), 0);

    markNotificationRead(a.id, false);

    assert.equal(getUnreadNotificationCount(), 1);
  });
});

describe("listNotifications", () => {
  test("only returns unread notifications when unreadOnly=true", () => {
    clearAllNotifications();
    const a = makeNotification({ title: "Unread A" });
    const b = makeNotification({ title: "Read B" });
    markNotificationRead(b.id, true);

    const unread = listNotifications({ unreadOnly: true });

    assert.ok(
      unread.some((n) => n.id === a.id),
      "unread notification must appear"
    );
    assert.ok(!unread.some((n) => n.id === b.id), "read notification must not appear");
  });
});

describe("deleteNotification", () => {
  test("removes the notification from the database", () => {
    const n = makeNotification();
    assert.ok(getNotification(n.id) !== null);

    deleteNotification(n.id);

    assert.equal(getNotification(n.id), null);
  });

  test("does not affect other notifications", () => {
    const a = makeNotification();
    const b = makeNotification();

    deleteNotification(a.id);

    assert.equal(getNotification(a.id), null);
    assert.ok(getNotification(b.id) !== null);
  });
});

// ── HTTP route layer ──────────────────────────────────────────────────────────

describe("PATCH /api/notifications/:id — HTTP persistence", () => {
  test("marks a notification as read via HTTP and persists to DB", async () => {
    const n = makeNotification({ title: "HTTP read test" });
    assert.equal(n.read, false);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/notifications/${n.id}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ read: true }),
    });

    assert.equal(response.statusCode, 200, `PATCH failed: ${response.body}`);

    // Verify the response body reflects the updated state
    const body = JSON.parse(response.body) as { read: boolean };
    assert.equal(body.read, true, "response must reflect read=true");

    // Verify it is actually persisted in the DB
    const persisted = getNotification(n.id);
    assert.ok(persisted !== null);
    assert.equal(persisted.read, true, "read=true must be persisted in the database");
  });

  test("marks a notification as unread via HTTP and persists to DB", async () => {
    const n = makeNotification();
    markNotificationRead(n.id, true);
    assert.equal(getNotification(n.id)?.read, true);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/notifications/${n.id}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ read: false }),
    });

    assert.equal(response.statusCode, 200, `PATCH failed: ${response.body}`);

    const persisted = getNotification(n.id);
    assert.ok(persisted !== null);
    assert.equal(persisted.read, false, "read=false must be persisted in the database");
  });

  test("returns 400 when body is missing the read field", async () => {
    const n = makeNotification();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/notifications/${n.id}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({}),
    });

    assert.equal(response.statusCode, 400);
  });

  test("returns 404 for a non-existent notification id", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/notifications/does-not-exist",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ read: true }),
    });

    assert.equal(response.statusCode, 404);
  });

  test("unread count drops to zero after marking all via HTTP POST read-all", async () => {
    clearAllNotifications();
    makeNotification();
    makeNotification();
    assert.equal(getUnreadNotificationCount(), 2);

    const response = await app.inject({
      method: "POST",
      url: "/api/notifications/read-all",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(getUnreadNotificationCount(), 0, "all notifications must be read in DB");
  });
});
