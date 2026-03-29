/**
 * skillRegistry.ts
 *
 * Dynamically loads every *.skill.js file from the skills directory and
 * caches the resulting definitions.  Skill files must export a default object
 * with at minimum: { name, description, input_schema, execute }.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { ToolDefinition } from "../types.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface SkillDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute(
    input?: Record<string, unknown>,
    context?: Record<string, unknown>
  ): Promise<unknown> | unknown;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILLS_DIR = process.env.SKILLS_DIR ?? __dirname;

let cachedSkills: Map<string, SkillDefinition> | null = null;

async function loadAll(): Promise<Map<string, SkillDefinition>> {
  if (cachedSkills) return cachedSkills;

  const map = new Map<string, SkillDefinition>();
  let files: string[];
  try {
    files = readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith(".skill.js"))
      .sort();
  } catch {
    cachedSkills = map;
    return map;
  }

  for (const file of files) {
    const url = `${pathToFileURL(join(SKILLS_DIR, file)).href}?v=${Date.now()}`;
    try {
      const mod = (await import(url)) as { default?: unknown; skill?: unknown };
      const skill = (mod.default ?? mod.skill) as SkillDefinition | undefined;
      if (skill?.name && typeof skill.execute === "function") {
        map.set(skill.name, skill);
      }
    } catch {
      // Skip malformed skill files silently
    }
  }

  cachedSkills = map;
  return map;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return all loaded skill definitions as OpenAI-style ToolDefinition objects. */
export async function getToolDefinitions(names: string[]): Promise<ToolDefinition[]> {
  const skills = await loadAll();
  return names
    .map((n) => skills.get(n))
    .filter((s): s is SkillDefinition => s !== undefined)
    .map((s) => ({
      type: "function" as const,
      function: {
        name: s.name,
        description: s.description,
        parameters: s.input_schema as Record<string, unknown>,
      },
    }));
}

/** Execute a skill by name.  Returns { error } if the skill is unknown. */
export async function executeSkill(
  name: string,
  input: Record<string, unknown>,
  context: Record<string, unknown> = {}
): Promise<unknown> {
  const skills = await loadAll();
  const skill = skills.get(name);
  if (!skill) return { error: `Unknown skill: ${name}` };
  try {
    return await Promise.resolve(skill.execute(input, context));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Skill execution failed" };
  }
}

/** Invalidate the cache (useful during development / hot-reload). */
export function invalidateSkillCache(): void {
  cachedSkills = null;
}
