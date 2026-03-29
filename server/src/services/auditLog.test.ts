/**
 * Tests for the audit log service.
 *
 * Covers: write, read, HMAC validation, tamper detection, and filtering.
 */
import { test, after, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Temp database ─────────────────────────────────────────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), "elaine-audit-test-"));
process.env.DATABASE_PATH = join(tmpDir, "test.db");
process.env.ELAINE_SECRET_KEY = "test-key-not-for-production-use";

const { logToolCall, listAuditLog } = await import("./auditLog.js");
const { db } = await import("../db/database.js");

after(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec("DELETE FROM tool_call_log");
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("logToolCall", () => {
  test("writes a row to tool_call_log", () => {
    logToolCall({
      conversationId: "conv-1",
      agentMode: "chat",
      skillName: "web_fetch",
      input: { url: "https://example.com" },
      result: { content: "hello" },
      success: true,
      durationMs: 42,
    });

    const rows = db.prepare("SELECT * FROM tool_call_log").all() as unknown[];
    assert.equal(rows.length, 1);
  });

  test("does not throw when result is null", () => {
    assert.doesNotThrow(() => {
      logToolCall({
        conversationId: null,
        agentMode: "scheduled",
        skillName: "think",
        input: {},
        result: null,
        success: true,
        durationMs: 0,
      });
    });
  });

  test("marks failed skill calls with success=0", () => {
    logToolCall({
      conversationId: "conv-2",
      agentMode: "task",
      skillName: "shell_exec",
      input: { command: "bad" },
      result: { error: "Command blocked" },
      success: false,
      durationMs: 1,
    });

    const row = db.prepare("SELECT success FROM tool_call_log").get() as { success: number };
    assert.equal(row.success, 0);
  });
});

describe("listAuditLog", () => {
  test("returns all entries when no filter is set", () => {
    logToolCall({
      conversationId: "conv-a",
      agentMode: "chat",
      skillName: "web_fetch",
      input: {},
      result: {},
      success: true,
      durationMs: 10,
    });
    logToolCall({
      conversationId: "conv-b",
      agentMode: "task",
      skillName: "shell_exec",
      input: {},
      result: {},
      success: true,
      durationMs: 20,
    });

    const entries = listAuditLog({});
    assert.equal(entries.length, 2);
  });

  test("filters by conversationId", () => {
    logToolCall({
      conversationId: "conv-x",
      agentMode: "chat",
      skillName: "web_fetch",
      input: {},
      result: {},
      success: true,
      durationMs: 5,
    });
    logToolCall({
      conversationId: "conv-y",
      agentMode: "chat",
      skillName: "web_fetch",
      input: {},
      result: {},
      success: true,
      durationMs: 5,
    });

    const entries = listAuditLog({ conversationId: "conv-x" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].conversationId, "conv-x");
  });

  test("filters by skillName", () => {
    logToolCall({
      conversationId: "c1",
      agentMode: "chat",
      skillName: "web_fetch",
      input: {},
      result: {},
      success: true,
      durationMs: 5,
    });
    logToolCall({
      conversationId: "c1",
      agentMode: "task",
      skillName: "shell_exec",
      input: {},
      result: {},
      success: true,
      durationMs: 5,
    });

    const entries = listAuditLog({ skillName: "shell_exec" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].skillName, "shell_exec");
  });

  test("respects limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      logToolCall({
        conversationId: "c",
        agentMode: "chat",
        skillName: "think",
        input: {},
        result: {},
        success: true,
        durationMs: i,
      });
    }
    const page1 = listAuditLog({ limit: 2, offset: 0 });
    const page2 = listAuditLog({ limit: 2, offset: 2 });
    assert.equal(page1.length, 2);
    assert.equal(page2.length, 2);
    assert.notEqual(page1[0].id, page2[0].id);
  });
});

describe("HMAC integrity", () => {
  test("valid field returns true for a freshly written entry", () => {
    logToolCall({
      conversationId: "conv-hmac",
      agentMode: "chat",
      skillName: "web_fetch",
      input: { url: "x" },
      result: { ok: 1 },
      success: true,
      durationMs: 7,
    });

    const [entry] = listAuditLog({ conversationId: "conv-hmac" });
    assert.ok(entry, "entry should exist");
    assert.equal(entry.valid, true, "HMAC should be valid on a fresh entry");
  });

  test("valid field returns false after result_json is tampered with", () => {
    logToolCall({
      conversationId: "conv-tamper",
      agentMode: "chat",
      skillName: "web_fetch",
      input: {},
      result: { data: "original" },
      success: true,
      durationMs: 3,
    });

    // Tamper directly in the DB
    db.prepare("UPDATE tool_call_log SET result_json = ? WHERE conversation_id = ?").run(
      JSON.stringify({ data: "TAMPERED" }),
      "conv-tamper"
    );

    const [entry] = listAuditLog({ conversationId: "conv-tamper" });
    assert.ok(entry, "entry should exist");
    assert.equal(entry.valid, false, "HMAC should be invalid after tampering");
  });

  test("valid field returns false after skill_name is changed", () => {
    logToolCall({
      conversationId: "conv-name-tamper",
      agentMode: "task",
      skillName: "file_read",
      input: {},
      result: {},
      success: true,
      durationMs: 2,
    });

    db.prepare("UPDATE tool_call_log SET skill_name = ? WHERE conversation_id = ?").run(
      "shell_exec",
      "conv-name-tamper"
    );

    const [entry] = listAuditLog({ conversationId: "conv-name-tamper" });
    assert.equal(entry.valid, false);
  });
});
