import { runSandboxedCommand } from "../services/shellSandbox.js";

export default {
  name: "shell_exec",
  description:
    "Execute a shell command and return stdout + stderr. Commands matching dangerous patterns are blocked.",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run" },
      cwd: {
        type: "string",
        description: "Working directory (defaults to workspace path)",
        default: ".",
      },
    },
    required: ["command"],
  },
  async execute(input = {}, context = {}) {
    if (!input.command || typeof input.command !== "string") {
      return { error: 'Missing required "command" string' };
    }
    const workspacePath =
      context.workspacePath && typeof context.workspacePath === "string"
        ? context.workspacePath
        : process.cwd();

    const result = await runSandboxedCommand({
      command: input.command,
      cwd: input.cwd || workspacePath,
      timeoutMs: 15_000,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      ...(result.error ? { blocked: true, reason: result.error } : {}),
    };
  },
};
