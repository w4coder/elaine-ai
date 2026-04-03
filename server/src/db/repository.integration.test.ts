/**
 * Integration tests for the message-flow repository layer.
 *
 * These tests use a real SQLite database (temp file) so that the full
 * persistence path — createConversation → createMessage → getConversation
 * → listMessages → deleteConversation — is exercised end-to-end.
 */
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Temp database ─────────────────────────────────────────────────────────────
// Must be set before any server module is imported; database.ts reads it once
// at module load time.
const tmpDir = mkdtempSync(join(tmpdir(), "elaine-test-"));
process.env.DATABASE_PATH = join(tmpDir, "test.db");
// Silence the crypto warning about the missing key
process.env.ELAINE_SECRET_KEY = "test-key-not-for-production-use";

// Dynamic imports so env vars are set first
const {
  createConversation,
  createMessage,
  getConversation,
  listConversations,
  deleteConversation,
  listMessages,
  listConversationSearchResults,
  getChannelSenderPermission,
  listChannelSenderPermissions,
  updateConversation,
  upsertChannelSenderPermission,
  deleteMessagesFromId,
} = await import("./repository.js");

const { db } = await import("./database.js");

// ── Cleanup ───────────────────────────────────────────────────────────────────
after(() => {
  // Close the SQLite connection so Windows releases the file lock before deletion
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeConversation(overrides: Partial<Parameters<typeof createConversation>[0]> = {}) {
  return createConversation({
    profileId: "profile-1",
    providerType: "openai",
    model: "gpt-4o",
    systemPrompt: "You are a helpful assistant.",
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createConversation", () => {
  test("returns a record with the expected fields", () => {
    const conversation = makeConversation({ title: "Hello world" });

    assert.equal(conversation.title, "Hello world");
    assert.equal(conversation.profileId, "profile-1");
    assert.equal(conversation.model, "gpt-4o");
    assert.equal(conversation.titleStatus, "idle");
    assert.ok(typeof conversation.id === "string" && conversation.id.length > 0);
    assert.ok(typeof conversation.createdAt === "string");
  });

  test("defaults title to 'New conversation' when not provided", () => {
    const conversation = makeConversation();
    assert.equal(conversation.title, "New conversation");
  });
});

describe("getConversation", () => {
  test("returns the conversation with an empty messages array initially", () => {
    const created = makeConversation({ title: "Empty chat" });
    const retrieved = getConversation(created.id);

    assert.ok(retrieved !== null);
    assert.equal(retrieved.id, created.id);
    assert.equal(retrieved.title, "Empty chat");
    assert.deepEqual(retrieved.messages, []);
  });

  test("returns null for an unknown id", () => {
    assert.equal(getConversation("does-not-exist"), null);
  });
});

describe("createMessage / listMessages", () => {
  test("persists a user message and retrieves it via getConversation", () => {
    const conversation = makeConversation({ title: "Message flow" });

    const userMsg = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "What is 2 + 2?",
    });

    assert.equal(userMsg.conversationId, conversation.id);
    assert.equal(userMsg.role, "user");
    assert.equal(userMsg.content, "What is 2 + 2?");
    assert.ok(typeof userMsg.id === "string" && userMsg.id.length > 0);

    const detail = getConversation(conversation.id);
    assert.ok(detail !== null);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].content, "What is 2 + 2?");
  });

  test("returns messages in insertion order", () => {
    const conversation = makeConversation({ title: "Ordered messages" });

    createMessage({ conversationId: conversation.id, role: "user", content: "First" });
    createMessage({ conversationId: conversation.id, role: "assistant", content: "Second" });
    createMessage({ conversationId: conversation.id, role: "user", content: "Third" });

    const messages = listMessages(conversation.id);
    assert.equal(messages.length, 3);
    assert.equal(messages[0].content, "First");
    assert.equal(messages[1].content, "Second");
    assert.equal(messages[2].content, "Third");
    assert.equal(messages[0].role, "user");
    assert.equal(messages[1].role, "assistant");
  });

  test("persists metadata on a message", () => {
    const conversation = makeConversation();
    const msg = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Here is a chart.",
      metadata: { widgets: [{ type: "chart", data: [1, 2, 3] }] },
    });

    const detail = getConversation(conversation.id);
    assert.ok(detail !== null);
    const retrieved = detail.messages.find((m) => m.id === msg.id);
    assert.ok(retrieved !== undefined);
    assert.deepEqual(retrieved.metadata, { widgets: [{ type: "chart", data: [1, 2, 3] }] });
  });
});

describe("listConversations", () => {
  test("includes newly created conversations", () => {
    const before = listConversations().map((c) => c.id);

    const a = makeConversation({ title: "Alpha" });
    createMessage({ conversationId: a.id, role: "user", content: "hi" });

    const b = makeConversation({ title: "Beta" });
    createMessage({ conversationId: b.id, role: "user", content: "hello" });

    const after = listConversations();
    const afterIds = after.map((c) => c.id);

    assert.ok(afterIds.includes(a.id));
    assert.ok(afterIds.includes(b.id));

    // Should have at least the two new conversations plus any prior ones
    assert.ok(after.length >= before.length + 2);
  });

  test("includes preview from the latest message", () => {
    const conversation = makeConversation({ title: "Preview test" });
    createMessage({ conversationId: conversation.id, role: "user", content: "Preview me" });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "This is the preview",
    });

    const list = listConversations();
    const found = list.find((c) => c.id === conversation.id);
    assert.ok(found !== undefined);
    assert.equal(found.preview, "This is the preview");
    assert.equal(found.messageCount, 2);
  });
});

describe("deleteConversation", () => {
  test("removes the conversation and its messages (cascade)", () => {
    const conversation = makeConversation({ title: "To be deleted" });
    createMessage({ conversationId: conversation.id, role: "user", content: "Goodbye" });

    assert.ok(getConversation(conversation.id) !== null);

    deleteConversation(conversation.id);

    assert.equal(getConversation(conversation.id), null);
    assert.deepEqual(listMessages(conversation.id), []);
  });
});

describe("deleteMessagesFromId", () => {
  test("truncates messages from a given message onward", () => {
    const conversation = makeConversation({ title: "Truncation test" });

    createMessage({ conversationId: conversation.id, role: "user", content: "Keep me" });
    const pivot = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Delete from here",
    });
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Also deleted",
    });

    deleteMessagesFromId(pivot.id);

    const messages = listMessages(conversation.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, "Keep me");
  });
});

describe("updateConversation", () => {
  test("can rename a conversation", () => {
    const conversation = makeConversation({ title: "Old title" });
    const updated = updateConversation(conversation.id, { title: "New title" });

    assert.ok(updated !== null);
    assert.equal(updated.title, "New title");

    const retrieved = getConversation(conversation.id);
    assert.ok(retrieved !== null);
    assert.equal(retrieved.title, "New title");
  });
});

describe("listConversationSearchResults", () => {
  test("finds relevant snippets from previous chats", () => {
    const planning = makeConversation({ title: "Trip planning" });
    createMessage({
      conversationId: planning.id,
      role: "user",
      content: "Let's compare hotels in Lisbon near the tram.",
    });
    createMessage({
      conversationId: planning.id,
      role: "assistant",
      content: "You preferred boutique hotels in Alfama with breakfast included.",
    });

    const coding = makeConversation({ title: "Release checklist" });
    createMessage({
      conversationId: coding.id,
      role: "user",
      content: "Remember to verify the staging deploy before the launch.",
    });

    const results = listConversationSearchResults("boutique hotels Lisbon", 3);

    assert.ok(results.length > 0);
    assert.equal(results[0].conversationId, planning.id);
    assert.match(results[0].snippet, /boutique hotels|Lisbon/i);
  });
});

describe("channel sender permissions", () => {
  test("stores and updates per-sender channel access decisions", () => {
    const approved = upsertChannelSenderPermission({
      connectionId: "conn-1",
      channelId: "telegram",
      senderId: "user-123",
      senderName: "Alice",
      status: "approved",
    });

    assert.equal(approved.status, "approved");
    assert.equal(getChannelSenderPermission("conn-1", "user-123")?.senderName, "Alice");

    const blocked = upsertChannelSenderPermission({
      connectionId: "conn-1",
      channelId: "telegram",
      senderId: "user-123",
      senderName: "Alice Cooper",
      status: "blocked",
    });

    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.senderName, "Alice Cooper");
    assert.ok(
      listChannelSenderPermissions("conn-1").some(
        (entry) => entry.senderId === "user-123" && entry.status === "blocked"
      )
    );
  });
});
