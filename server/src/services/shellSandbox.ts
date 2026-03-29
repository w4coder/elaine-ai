/**
 * shellSandbox.ts
 *
 * Runs shell commands in a Node.js worker thread with:
 *  - Memory resource limits (isolates OOM from the main process)
 *  - A denylist that blocks known destructive/dangerous patterns before execution
 *  - Enforced timeout (hard-kills the worker after the deadline)
 *
 * This is a best-effort sandbox on platforms that lack OS-level containers
 * (e.g. Windows without Docker).  It does NOT provide full filesystem
 * isolation — use Docker or nsjail for that when available.
 */

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Denylist — patterns blocked regardless of mode or permissions
// ---------------------------------------------------------------------------

const DENY_PATTERNS: RegExp[] = [
  // Disk-wiping / mass-delete
  /rm\s+-[^-]*r[^-]*f|rm\s+--force\s+--recursive/i,
  /rd\s+\/s\s+\/q/i, // Windows rmdir /s /q
  /format\s+[a-z]:/i, // Windows format drive
  /mkfs\./i, // Linux format
  /dd\s+.*of=\/dev\//i, // dd to device
  /:\(\)\s*\{.*:\|:.*\}/, // fork bomb
  // Privilege escalation
  /sudo\s+su|sudo\s+-i|sudo\s+-s/i,
  /chmod\s+[0-9]*7[0-9]*\s+\/etc/i,
  /chown.*:.*\s+\/etc/i,
  // Exfiltration helpers
  /curl.*\|\s*(ba)?sh/i,
  /wget.*\|\s*(ba)?sh/i,
  /powershell.*downloadstring.*invoke/i,
  // Critical system paths
  />\s*\/etc\/(passwd|shadow|sudoers)/i,
  />\s*\/boot\//i,
];

export function isDenied(command: string): { denied: boolean; reason?: string } {
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(command)) {
      return { denied: true, reason: `Command matches blocked pattern: ${pattern.source}` };
    }
  }
  return { denied: false };
}

// ---------------------------------------------------------------------------
// Worker payload types
// ---------------------------------------------------------------------------

interface WorkerInput {
  command: string;
  cwd: string;
  timeoutMs: number;
}

interface WorkerOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Worker body — runs in a separate thread
// ---------------------------------------------------------------------------

function workerBody() {
  // This function is serialised to a string and run via a data: URL worker.
  // It must be self-contained (no imports).
  if (!parentPort) return;
  const { command, cwd, timeoutMs } = workerData as WorkerInput;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync: exec } = require("child_process") as typeof import("child_process");
    const stdout = exec(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
      encoding: "utf8",
    }) as string;
    parentPort.postMessage({ stdout: stdout.slice(0, 4000), stderr: "", exit_code: 0 });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; status?: number };
    parentPort.postMessage({
      stdout: (e.stdout ?? "").slice(0, 2000),
      stderr: (e.stderr ?? e.message ?? "Unknown error").slice(0, 1000),
      exit_code: e.status ?? 1,
    });
  }
}

// ---------------------------------------------------------------------------
// Main-thread executor
// ---------------------------------------------------------------------------

const WORKER_SCRIPT = `
const { workerData, parentPort } = require('worker_threads');
${workerBody.toString()}
workerBody();
`;

export function runSandboxedCommand(opts: {
  command: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<WorkerOutput> {
  const timeoutMs = opts.timeoutMs ?? 15_000;

  // Denylist check before spawning anything
  const check = isDenied(opts.command);
  if (check.denied) {
    return Promise.resolve({
      stdout: "",
      stderr: check.reason ?? "Command blocked by security policy",
      exit_code: 1,
      error: check.reason,
    });
  }

  return new Promise((resolve) => {
    let settled = false;

    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      workerData: { command: opts.command, cwd: opts.cwd, timeoutMs } satisfies WorkerInput,
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 64,
      },
    });

    const hardKill = setTimeout(() => {
      if (!settled) {
        settled = true;
        void worker.terminate();
        resolve({ stdout: "", stderr: "Command timed out", exit_code: 124 });
      }
    }, timeoutMs + 2_000); // extra buffer before hard kill

    worker.once("message", (msg: WorkerOutput) => {
      if (!settled) {
        settled = true;
        clearTimeout(hardKill);
        resolve(msg);
      }
    });

    worker.once("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(hardKill);
        resolve({ stdout: "", stderr: err.message, exit_code: 1, error: err.message });
      }
    });

    worker.once("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(hardKill);
        resolve({ stdout: "", stderr: `Worker exited with code ${code}`, exit_code: code ?? 1 });
      }
    });
  });
}

// Re-export execSync as a fallback for environments that don't support workers
export { execSync };
