/**
 * skillsConfig.ts
 *
 * Reads skills.config.json to determine which skills are available per intent.
 * The config file is the single source of truth — edit it to add / remove skills
 * without touching code.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getToolDefinitions } from "./skillRegistry.js";
import type { ToolDefinition } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SkillsConfig {
  chat: string[];
  task: string[];
}

function loadConfig(): SkillsConfig {
  try {
    const raw = readFileSync(join(__dirname, "skills.config.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<SkillsConfig>;
    return {
      chat: Array.isArray(parsed.chat) ? parsed.chat.filter((s) => typeof s === "string") : [],
      task: Array.isArray(parsed.task) ? parsed.task.filter((s) => typeof s === "string") : [],
    };
  } catch {
    return { chat: [], task: [] };
  }
}

/**
 * Return the tool definitions for the given intent mode.
 * Falls back to an empty list on any error so the chat path is never blocked.
 */
export async function getToolsForIntent(intent: "chat" | "task"): Promise<ToolDefinition[]> {
  try {
    const config = loadConfig();
    const names = intent === "task" ? config.task : config.chat;
    return await getToolDefinitions(names);
  } catch {
    return [];
  }
}
