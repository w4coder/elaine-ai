import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, isAbsolute, relative } from "path";

const AGENT_FILES_DIR = ".agent_files";

/**
 * All agent writes are contained inside <workspace>/.agent_files/.
 *
 * - Relative paths are resolved under .agent_files/ directly.
 * - Absolute paths inside the workspace are remapped to their workspace-relative
 *   equivalent under .agent_files/.
 * - Absolute paths outside the workspace use only the final filename under .agent_files/.
 */
function resolveAgentPath(inputPath, base) {
  const agentBase = resolve(base, AGENT_FILES_DIR);

  if (!isAbsolute(inputPath)) {
    // Relative path — resolve under .agent_files/
    return resolve(agentBase, inputPath);
  }

  // Absolute path — remap into .agent_files/
  const rel = relative(base, inputPath);
  if (!rel.startsWith("..")) {
    // Path was inside workspace — preserve structure
    return resolve(agentBase, rel);
  }

  // Path was outside workspace — use only the filename
  const filename = inputPath.split(/[/\\]/).pop() || "output.txt";
  return resolve(agentBase, filename);
}

export default {
  name: "file_write",
  description:
    "Write or append content to a file. All files are saved under .agent_files/ in the workspace.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Path to write to. Relative paths are resolved under .agent_files/. Absolute paths are remapped into .agent_files/ automatically.",
      },
      content: { type: "string", description: "Content to write" },
      append: {
        type: "boolean",
        description: "If true, append instead of overwrite",
        default: false,
      },
    },
    required: ["path", "content"],
  },
  execute(input = {}, context = {}) {
    if (!input.path || typeof input.path !== "string") {
      return { error: 'Missing required "path" string' };
    }
    if (typeof input.content !== "string") {
      return { error: 'Missing required "content" string' };
    }

    const base =
      context.workspacePath && typeof context.workspacePath === "string"
        ? context.workspacePath
        : process.cwd();

    const fullPath = resolveAgentPath(input.path, base);

    try {
      mkdirSync(dirname(fullPath), { recursive: true });
      const existedBefore = existsSync(fullPath);
      if (input.append) {
        const existing = existedBefore ? readFileSync(fullPath, "utf8") : "";
        writeFileSync(fullPath, existing + input.content, "utf8");
      } else {
        writeFileSync(fullPath, input.content, "utf8");
      }
      return {
        written: true,
        path: fullPath,
        bytes: input.content.length,
        existed_before: existedBefore,
        mode: input.append ? "append" : "overwrite",
      };
    } catch (error) {
      return { error: error.message };
    }
  },
};
