/**
 * auditLog.ts
 *
 * Tamper-evident append-only log of every agent tool call.
 * Each row is HMAC-SHA256 signed over its core fields so that
 * post-hoc edits to the SQLite file are detectable.
 */

import { createHmac, randomUUID } from "node:crypto";
import { db } from "../db/database.js";

// ---------------------------------------------------------------------------
// Secret — generated once and stored in settings, never rotated automatically
// ---------------------------------------------------------------------------

const HMAC_KEY_SETTING = "audit_hmac_key";

function getOrCreateHmacKey(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(HMAC_KEY_SETTING) as
    | { value: string }
    | undefined;
  if (row) return row.value;
  const key = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(HMAC_KEY_SETTING, key);
  return key;
}

const HMAC_KEY = getOrCreateHmacKey();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  conversationId: string | null;
  agentMode: string;
  skillName: string;
  inputJson: string;
  resultJson: string;
  success: boolean;
  durationMs: number;
  createdAt: string;
  hmac: string;
  valid: boolean; // true when HMAC matches
}

interface AuditRow {
  id: string;
  conversation_id: string | null;
  agent_mode: string;
  skill_name: string;
  input_json: string;
  result_json: string;
  success: number;
  duration_ms: number;
  created_at: string;
  hmac: string;
}

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------

function sign(fields: {
  id: string;
  conversationId: string | null;
  agentMode: string;
  skillName: string;
  inputJson: string;
  resultJson: string;
  createdAt: string;
}): string {
  const payload = [
    fields.id,
    fields.conversationId ?? "",
    fields.agentMode,
    fields.skillName,
    fields.inputJson,
    fields.resultJson,
    fields.createdAt,
  ].join("|");
  return createHmac("sha256", HMAC_KEY).update(payload).digest("hex");
}

function verify(entry: AuditRow): boolean {
  const expected = sign({
    id: entry.id,
    conversationId: entry.conversation_id,
    agentMode: entry.agent_mode,
    skillName: entry.skill_name,
    inputJson: entry.input_json,
    resultJson: entry.result_json,
    createdAt: entry.created_at,
  });
  return expected === entry.hmac;
}

const INSERT = db.prepare(`
  INSERT INTO tool_call_log
    (id, conversation_id, agent_mode, skill_name, input_json, result_json, success, duration_ms, created_at, hmac)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function logToolCall(opts: {
  conversationId: string | null;
  agentMode: string;
  skillName: string;
  input: unknown;
  result: unknown;
  success: boolean;
  durationMs: number;
}): void {
  try {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const inputJson = JSON.stringify(opts.input ?? null);
    const resultJson = JSON.stringify(opts.result ?? null);
    const hmac = sign({
      id,
      conversationId: opts.conversationId,
      agentMode: opts.agentMode,
      skillName: opts.skillName,
      inputJson,
      resultJson,
      createdAt,
    });
    INSERT.run(
      id,
      opts.conversationId,
      opts.agentMode,
      opts.skillName,
      inputJson,
      resultJson,
      opts.success ? 1 : 0,
      opts.durationMs,
      createdAt,
      hmac
    );
  } catch {
    // Audit log must never crash the agent loop
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function listAuditLog(opts: {
  conversationId?: string;
  skillName?: string;
  limit?: number;
  offset?: number;
}): AuditLogEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.conversationId) {
    conditions.push("conversation_id = ?");
    params.push(opts.conversationId);
  }
  if (opts.skillName) {
    conditions.push("skill_name = ?");
    params.push(opts.skillName);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  params.push(limit, offset);

  const rows = db
    .prepare(`SELECT * FROM tool_call_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params) as AuditRow[];

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    agentMode: row.agent_mode,
    skillName: row.skill_name,
    inputJson: row.input_json,
    resultJson: row.result_json,
    success: row.success === 1,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    hmac: row.hmac,
    valid: verify(row),
  }));
}
