/**
 * Tests for file_write.skill.js — agent files containment.
 *
 * Verifies that every write lands inside .agent_files/ regardless of
 * how the path is specified (relative, absolute inside workspace,
 * absolute outside workspace).
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ── Temp workspace ────────────────────────────────────────────────────────────
const workspace = mkdtempSync(join(tmpdir(), "elaine-fw-test-"));

after(() => rmSync(workspace, { recursive: true, force: true }));

// Dynamic import so the skill is loaded fresh
// @ts-ignore – JS skill file has no declaration
const { default: skill } = await import("./file_write.skill.js");

function run(path: string, content = "hello", append = false) {
  return skill.execute({ path, content, append }, { workspacePath: workspace }) as {
    written?: boolean;
    path?: string;
    error?: string;
    bytes?: number;
    mode?: string;
    existed_before?: boolean;
  };
}

const agentBase = resolve(workspace, ".agent_files");

// ── Path containment ──────────────────────────────────────────────────────────

describe("file_write — all writes go to .agent_files/", () => {
  test("relative path is written under .agent_files/", () => {
    const result = run("report.md");
    assert.ok(result.written);
    assert.ok(result.path!.startsWith(agentBase), `path: ${result.path}`);
    assert.ok(existsSync(result.path!));
  });

  test("nested relative path preserves structure under .agent_files/", () => {
    const result = run("data/output/result.json", '{"ok":true}');
    assert.ok(result.written);
    assert.ok(result.path!.startsWith(agentBase));
    assert.ok(result.path!.includes("data") && result.path!.includes("output"));
  });

  test("absolute path inside workspace is remapped to .agent_files/", () => {
    const absoluteInside = resolve(workspace, "some/nested/file.txt");
    const result = run(absoluteInside);
    assert.ok(result.written);
    assert.ok(
      result.path!.startsWith(agentBase),
      `expected under .agent_files/, got: ${result.path}`
    );
  });

  test("absolute path outside workspace uses only the filename under .agent_files/", () => {
    const absoluteOutside = resolve(tmpdir(), "sensitive_system_file.txt");
    const result = run(absoluteOutside);
    assert.ok(result.written);
    assert.ok(
      result.path!.startsWith(agentBase),
      `expected under .agent_files/, got: ${result.path}`
    );
    assert.ok(result.path!.endsWith("sensitive_system_file.txt"));
    // Must NOT have written outside the workspace
    assert.equal(existsSync(absoluteOutside), false);
  });
});

// ── Content integrity ─────────────────────────────────────────────────────────

describe("file_write — content is written correctly", () => {
  test("overwrites existing content by default", () => {
    run("overwrite.txt", "first");
    run("overwrite.txt", "second");
    const result = run("overwrite.txt", "third");
    assert.ok(result.written);
    const content = readFileSync(result.path!, "utf8");
    assert.equal(content, "third");
  });

  test("appends when append=true", () => {
    run("append.txt", "line1\n");
    run("append.txt", "line2\n", true);
    const result = run("append.txt", "line3\n", true);
    const content = readFileSync(result.path!, "utf8");
    assert.ok(content.includes("line1") && content.includes("line2") && content.includes("line3"));
  });

  test("returns correct byte count", () => {
    const content = "hello world";
    const result = run("bytes.txt", content);
    assert.equal(result.bytes, content.length);
  });

  test("reports existed_before correctly", () => {
    const r1 = run("new-file.txt", "a");
    assert.equal(r1.existed_before, false);
    const r2 = run("new-file.txt", "b");
    assert.equal(r2.existed_before, true);
  });
});
