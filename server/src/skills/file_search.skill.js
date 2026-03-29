import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve, isAbsolute } from "path";

export default {
  name: "file_search",
  description: "Search for files by name pattern or content. Returns matching file paths.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: 'Pattern to match file names, e.g. "*.js" or "config"',
      },
      directory: {
        type: "string",
        description: "Directory to search in (defaults to cwd)",
        default: ".",
      },
      content: { type: "string", description: "Optional: search for this text inside files" },
    },
    required: ["pattern"],
  },
  execute(input = {}, context = {}) {
    if (!input.pattern || typeof input.pattern !== "string") {
      return { error: 'Missing required "pattern" string' };
    }

    const workspacePath =
      context.workspacePath && typeof context.workspacePath === "string"
        ? context.workspacePath
        : process.cwd();
    const rawDir = input.directory || ".";
    const dir = isAbsolute(rawDir) ? rawDir : resolve(workspacePath, rawDir);
    const results = [];

    function walk(path, depth = 0) {
      if (depth > 5) return;
      let entries;
      try {
        entries = readdirSync(path);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const fullPath = join(path, entry);

        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
          continue;
        }

        const pattern = input.pattern.replace("*", "");
        const matched = !input.pattern.includes("*")
          ? entry.includes(input.pattern)
          : entry.includes(pattern);
        if (matched) {
          results.push(fullPath);
        }

        if (input.content && results.length < 20) {
          try {
            const text = readFileSync(fullPath, "utf8");
            if (text.includes(input.content)) {
              results.push(`${fullPath} [contains: "${input.content}"]`);
            }
          } catch {
            // ignore unreadable files
          }
        }
      }
    }

    walk(dir);
    return { matches: results.slice(0, 30), count: results.length };
  },
};
