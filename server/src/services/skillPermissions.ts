/**
 * skillPermissions.ts
 *
 * Tracks which capabilities have been granted per conversation.
 *
 * Permission mode per agent mode (from AppSettings.skillPermissions):
 *   "auto" — all capabilities are pre-granted (default for task + scheduled)
 *   "ask"  — non-safe capabilities require an explicit grant (default for chat)
 *
 * Grants are stored in memory and reset on server restart.
 * The DB stores only the audit log; grants are intentionally ephemeral.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "../db/repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Capability map
// ---------------------------------------------------------------------------

type Capability = "safe" | "network" | "filesystem_read" | "filesystem_write" | "shell";

let capabilityMap: Record<string, Capability> | null = null;

function loadCapabilities(): Record<string, Capability> {
  if (capabilityMap) return capabilityMap;
  try {
    const raw = readFileSync(join(__dirname, "..", "skills", "skill-capabilities.json"), "utf8");
    capabilityMap = JSON.parse(raw) as Record<string, Capability>;
  } catch {
    capabilityMap = {};
  }
  return capabilityMap;
}

export function getSkillCapability(skillName: string): Capability {
  return loadCapabilities()[skillName] ?? "safe";
}

// ---------------------------------------------------------------------------
// Grant store  (conversationId → Map<capability, GrantType>)
// ---------------------------------------------------------------------------

export type GrantType = "once" | "thread";

const grants = new Map<string, Map<Capability, GrantType>>();

export function grantCapability(
  conversationId: string,
  capability: Capability,
  type: GrantType = "thread"
): void {
  if (!grants.has(conversationId)) grants.set(conversationId, new Map());
  grants.get(conversationId)!.set(capability, type);
}

export function revokeCapability(conversationId: string, capability: Capability): void {
  grants.get(conversationId)?.delete(capability);
}

/**
 * If the capability was granted as "once", consume and revoke it now.
 * Called by the agent loop immediately after a tool executes successfully.
 */
export function consumeOnceGrant(conversationId: string, capability: Capability): void {
  const entry = grants.get(conversationId)?.get(capability);
  if (entry === "once") {
    grants.get(conversationId)!.delete(capability);
  }
}

function isGranted(conversationId: string, capability: Capability): boolean {
  return grants.get(conversationId)?.has(capability) ?? false;
}

// ---------------------------------------------------------------------------
// Permission check
// ---------------------------------------------------------------------------

export type PermissionMode = "auto" | "ask";

export interface SkillPermissionsSettings {
  chat: PermissionMode;
  task: PermissionMode;
  scheduled: PermissionMode;
}

export const DEFAULT_SKILL_PERMISSIONS: SkillPermissionsSettings = {
  chat: "ask",
  task: "ask",
  scheduled: "auto",
};

function getPermissionMode(agentMode: string): PermissionMode {
  const settings = getSettings();
  const perms: SkillPermissionsSettings = {
    ...DEFAULT_SKILL_PERMISSIONS,
    ...(settings.skillPermissions as Partial<SkillPermissionsSettings> | undefined),
  };
  if (agentMode === "task") return perms.task;
  if (agentMode === "scheduled") return perms.scheduled;
  return perms.chat;
}

/**
 * Returns true when the skill may execute immediately.
 * Returns false when the agent should pause and ask the user for permission.
 */
export function isSkillAllowed(opts: {
  skillName: string;
  agentMode: string;
  conversationId: string | null;
}): boolean {
  const capability = getSkillCapability(opts.skillName);
  if (capability === "safe") return true;

  const mode = getPermissionMode(opts.agentMode);
  if (mode === "auto") return true;

  if (!opts.conversationId) return true; // no conversation to gate on
  return isGranted(opts.conversationId, capability);
}
