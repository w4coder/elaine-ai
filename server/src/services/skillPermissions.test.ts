/**
 * Tests for the skill permission model.
 *
 * Covers: capability lookup, mode-based auto-grant, explicit grants/revokes,
 * and the isSkillAllowed decision for each agent mode.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

// ── Temp database (skillPermissions reads settings from DB) ───────────────────
const tmpDir = mkdtempSync(join(tmpdir(), "elaine-perm-test-"));
process.env.DATABASE_PATH = join(tmpDir, "test.db");
process.env.ELAINE_SECRET_KEY = "test-key-not-for-production-use";

const { db } = await import("../db/database.js");
const { getSkillCapability, isSkillAllowed, grantCapability, revokeCapability, consumeOnceGrant } =
  await import("./skillPermissions.js");

after(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Reset grant store between tests by revoking all known capabilities
const ALL_CAPS = ["network", "filesystem_read", "filesystem_write", "shell"] as const;
const TEST_CONV = "test-conversation-id";

beforeEach(() => {
  for (const cap of ALL_CAPS) revokeCapability(TEST_CONV, cap);
});

// ── getSkillCapability ────────────────────────────────────────────────────────

describe("getSkillCapability", () => {
  test("returns 'safe' for internal skills", () => {
    assert.equal(getSkillCapability("think"), "safe");
    assert.equal(getSkillCapability("ask_user"), "safe");
    assert.equal(getSkillCapability("task_done"), "safe");
    assert.equal(getSkillCapability("memory_search"), "safe");
    assert.equal(getSkillCapability("visualize__show_widget"), "safe");
  });

  test("returns 'network' for web_fetch", () => {
    assert.equal(getSkillCapability("web_fetch"), "network");
  });

  test("returns 'filesystem_read' for file_read and file_search", () => {
    assert.equal(getSkillCapability("file_read"), "filesystem_read");
    assert.equal(getSkillCapability("file_search"), "filesystem_read");
  });

  test("returns 'filesystem_write' for file_write", () => {
    assert.equal(getSkillCapability("file_write"), "filesystem_write");
  });

  test("returns 'shell' for shell_exec", () => {
    assert.equal(getSkillCapability("shell_exec"), "shell");
  });

  test("returns 'safe' for unknown skills (safe default)", () => {
    assert.equal(getSkillCapability("nonexistent_skill"), "safe");
  });
});

// ── isSkillAllowed — safe skills ──────────────────────────────────────────────

describe("isSkillAllowed — safe skills always allowed", () => {
  for (const mode of ["chat", "task", "scheduled"] as const) {
    test(`think is allowed in ${mode} mode`, () => {
      assert.equal(
        isSkillAllowed({ skillName: "think", agentMode: mode, conversationId: TEST_CONV }),
        true
      );
    });

    test(`task_done is allowed in ${mode} mode`, () => {
      assert.equal(
        isSkillAllowed({ skillName: "task_done", agentMode: mode, conversationId: TEST_CONV }),
        true
      );
    });
  }
});

// ── isSkillAllowed — chat mode (ask by default) ───────────────────────────────

describe("isSkillAllowed — chat mode (ask by default)", () => {
  test("shell_exec is blocked without a grant", () => {
    assert.equal(
      isSkillAllowed({ skillName: "shell_exec", agentMode: "chat", conversationId: TEST_CONV }),
      false
    );
  });

  test("web_fetch is blocked without a grant", () => {
    assert.equal(
      isSkillAllowed({ skillName: "web_fetch", agentMode: "chat", conversationId: TEST_CONV }),
      false
    );
  });

  test("file_write is blocked without a grant", () => {
    assert.equal(
      isSkillAllowed({ skillName: "file_write", agentMode: "chat", conversationId: TEST_CONV }),
      false
    );
  });

  test("shell_exec is allowed after grantCapability", () => {
    grantCapability(TEST_CONV, "shell");
    assert.equal(
      isSkillAllowed({ skillName: "shell_exec", agentMode: "chat", conversationId: TEST_CONV }),
      true
    );
  });

  test("revokeCapability re-blocks the skill", () => {
    grantCapability(TEST_CONV, "shell");
    revokeCapability(TEST_CONV, "shell");
    assert.equal(
      isSkillAllowed({ skillName: "shell_exec", agentMode: "chat", conversationId: TEST_CONV }),
      false
    );
  });

  test("grant on one conversation does not affect another", () => {
    grantCapability(TEST_CONV, "network");
    assert.equal(
      isSkillAllowed({ skillName: "web_fetch", agentMode: "chat", conversationId: "other-conv" }),
      false
    );
  });
});

// ── isSkillAllowed — task mode (ask by default) ───────────────────────────────

describe("isSkillAllowed — task mode (ask by default)", () => {
  test("shell_exec is blocked without explicit grant", () => {
    assert.equal(
      isSkillAllowed({ skillName: "shell_exec", agentMode: "task", conversationId: TEST_CONV }),
      false
    );
  });

  test("file_write is blocked without explicit grant", () => {
    assert.equal(
      isSkillAllowed({ skillName: "file_write", agentMode: "task", conversationId: TEST_CONV }),
      false
    );
  });

  test("web_fetch is blocked without explicit grant", () => {
    assert.equal(
      isSkillAllowed({ skillName: "web_fetch", agentMode: "task", conversationId: TEST_CONV }),
      false
    );
  });

  test("shell_exec is allowed after grantCapability in task mode", () => {
    grantCapability(TEST_CONV, "shell");
    assert.equal(
      isSkillAllowed({ skillName: "shell_exec", agentMode: "task", conversationId: TEST_CONV }),
      true
    );
  });
});

// ── isSkillAllowed — scheduled mode (auto by default) ────────────────────────

describe("isSkillAllowed — scheduled mode (auto by default)", () => {
  test("shell_exec is allowed in scheduled mode", () => {
    assert.equal(
      isSkillAllowed({
        skillName: "shell_exec",
        agentMode: "scheduled",
        conversationId: TEST_CONV,
      }),
      true
    );
  });

  test("file_write is allowed in scheduled mode", () => {
    assert.equal(
      isSkillAllowed({
        skillName: "file_write",
        agentMode: "scheduled",
        conversationId: TEST_CONV,
      }),
      true
    );
  });
});

// ── consumeOnceGrant ─────────────────────────────────────────────────────────

describe("consumeOnceGrant", () => {
  test("once grant allows exactly one call then is revoked", () => {
    grantCapability(TEST_CONV, "network", "once");
    assert.equal(
      isSkillAllowed({ skillName: "web_fetch", agentMode: "chat", conversationId: TEST_CONV }),
      true
    );
    consumeOnceGrant(TEST_CONV, "network");
    assert.equal(
      isSkillAllowed({ skillName: "web_fetch", agentMode: "chat", conversationId: TEST_CONV }),
      false
    );
  });

  test("thread grant is NOT consumed by consumeOnceGrant", () => {
    grantCapability(TEST_CONV, "network", "thread");
    consumeOnceGrant(TEST_CONV, "network");
    assert.equal(
      isSkillAllowed({ skillName: "web_fetch", agentMode: "chat", conversationId: TEST_CONV }),
      true
    );
  });

  test("consumeOnceGrant on non-existent grant is a no-op", () => {
    assert.doesNotThrow(() => consumeOnceGrant("unknown-conv", "shell"));
  });
});

// ── null conversationId edge case ─────────────────────────────────────────────

describe("isSkillAllowed — null conversationId", () => {
  test("allows execution when conversationId is null (no context to gate on)", () => {
    // In chat mode without a conversationId (e.g. ephemeral) we can't gate, so allow
    assert.equal(
      isSkillAllowed({ skillName: "shell_exec", agentMode: "chat", conversationId: null }),
      true
    );
  });
});
