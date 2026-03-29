import { existsSync, readFileSync } from "fs";
import { resolve, isAbsolute } from "path";

export default {
  name: "file_read",
  description: "Read the contents of a file.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file (relative paths resolve against the workspace)",
      },
      start_line: { type: "number", description: "First line to read (1-indexed, optional)" },
      end_line: { type: "number", description: "Last line to read (optional)" },
    },
    required: ["path"],
  },
  execute(input = {}, context = {}) {
    if (!input.path || typeof input.path !== "string") {
      return { error: 'Missing required "path" string' };
    }

    const base =
      context.workspacePath && typeof context.workspacePath === "string"
        ? context.workspacePath
        : process.cwd();
    const fullPath = isAbsolute(input.path) ? input.path : resolve(base, input.path);

    if (!existsSync(fullPath)) return { error: `File not found: ${fullPath}` };

    const content = readFileSync(fullPath, "utf8");
    if (input.start_line || input.end_line) {
      const lines = content.split("\n");
      const start = (input.start_line || 1) - 1;
      const end = input.end_line || lines.length;
      return { content: lines.slice(start, end).join("\n"), total_lines: lines.length };
    }
    return { content: content.slice(0, 12000), total_lines: content.split("\n").length };
  },
};
