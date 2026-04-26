import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import { getDefaultSettings } from "../utils/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..", "..");
dotenv.config({ path: resolve(projectRoot, ".env") });

const configuredPath = process.env.DATABASE_PATH ?? "./server/data/elaine.db";
const databasePath = isAbsolute(configuredPath)
  ? configuredPath
  : resolve(projectRoot, configuredPath);

mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    title_status TEXT NOT NULL DEFAULT 'idle',
    title_source TEXT NOT NULL DEFAULT 'placeholder',
    profile_id TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    model TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    workspace_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_models (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_user_models_profile_model ON user_models(profile_id, model);
`);

// Migrations for new columns/tables
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN conversation_type TEXT NOT NULL DEFAULT 'chat'`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`ALTER TABLE scheduled_jobs ADD COLUMN last_run_conversation_id TEXT`);
} catch {
  // Column already exists — ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS pending_interaction (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    payload         TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tool_call_log (
    id         TEXT PRIMARY KEY,
    conversation_id TEXT,
    agent_mode TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    success    INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    hmac       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tool_call_log_conversation ON tool_call_log(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tool_call_log_created ON tool_call_log(created_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    user_prompt TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    model TEXT NOT NULL,
    interval_ms INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    max_runs INTEGER,
    run_count INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    next_run_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    target_url TEXT,
    metadata TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_app_notifications_created ON app_notifications(created_at DESC);
`);

try {
  db.exec(`ALTER TABLE app_notifications ADD COLUMN metadata TEXT`);
} catch {
  // Column already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS channel_conversations (
    channel_key TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS channel_sender_permissions (
    connection_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT,
    status TEXT NOT NULL CHECK(status IN ('approved', 'blocked')),
    decided_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, sender_id)
  );
  CREATE INDEX IF NOT EXISTS idx_channel_sender_permissions_status
    ON channel_sender_permissions(channel_id, status, updated_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS channel_pending_messages (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT,
    conversation_key TEXT NOT NULL,
    reply_target_id TEXT NOT NULL,
    reply_thread_id TEXT,
    reply_message_id TEXT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_channel_pending_messages_sender
    ON channel_pending_messages(connection_id, sender_id, created_at ASC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS channel_capability_grants (
    connection_id TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    capability TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('once', 'chat', 'deny')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, conversation_key, capability)
  );
  CREATE INDEX IF NOT EXISTS idx_channel_capability_grants_lookup
    ON channel_capability_grants(connection_id, conversation_key, updated_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS channel_pending_capability_requests (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT,
    reply_target_id TEXT NOT NULL,
    reply_thread_id TEXT,
    reply_message_id TEXT,
    capability TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_channel_pending_capability_requests_lookup
    ON channel_pending_capability_requests(connection_id, scope_key, capability, created_at ASC);
`);

try {
  db.exec(`ALTER TABLE channel_pending_capability_requests ADD COLUMN scope_key TEXT`);
} catch {
  // Column already exists
}
db.exec(`
  UPDATE channel_pending_capability_requests
  SET scope_key = connection_id || ':target:' || reply_target_id
  WHERE scope_key IS NULL OR scope_key = ''
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_connections (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    account_id TEXT NOT NULL,
    account_name TEXT,
    account_email TEXT,
    account_avatar TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TEXT,
    routing_mode TEXT NOT NULL DEFAULT 'direct',
    reply_in_thread INTEGER NOT NULL DEFAULT 1,
    scopes TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, account_id)
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_connections_provider ON oauth_connections(provider);
`);

try {
  db.exec(`ALTER TABLE channel_pending_messages ADD COLUMN conversation_key TEXT`);
} catch {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE channel_pending_messages ADD COLUMN reply_thread_id TEXT`);
} catch {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE channel_pending_messages ADD COLUMN reply_message_id TEXT`);
} catch {
  // Column already exists
}
db.exec(`
  UPDATE channel_pending_messages
  SET conversation_key = connection_id || ':' || sender_id
  WHERE conversation_key IS NULL OR conversation_key = ''
`);

try {
  db.exec(`ALTER TABLE oauth_connections ADD COLUMN routing_mode TEXT NOT NULL DEFAULT 'direct'`);
} catch {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE oauth_connections ADD COLUMN reply_in_thread INTEGER NOT NULL DEFAULT 1`);
} catch {
  // Column already exists
}

const settingsRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("app_settings") as
  | { value: string }
  | undefined;

if (!settingsRow) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "app_settings",
    JSON.stringify(getDefaultSettings())
  );
}

migrateLegacyUserModels(settingsRow?.value);

function migrateLegacyUserModels(rawSettings?: string): void {
  if (!rawSettings) {
    return;
  }

  try {
    const parsed = JSON.parse(rawSettings) as {
      profiles?: Array<{ id?: string; pinnedModels?: string[] }>;
    };
    const insert = db.prepare(
      "INSERT OR IGNORE INTO user_models (id, profile_id, model, created_at) VALUES (?, ?, ?, ?)"
    );
    const timestamp = new Date().toISOString();

    for (const profile of parsed.profiles ?? []) {
      if (!profile.id) {
        continue;
      }

      for (const model of profile.pinnedModels ?? []) {
        const trimmed = model.trim();
        if (!trimmed) {
          continue;
        }

        insert.run(randomUUID(), profile.id, trimmed, timestamp);
      }
    }
  } catch {
    // Ignore malformed legacy settings and continue with an empty model store.
  }
}

export function hasBuiltClient(): boolean {
  return existsSync(resolve(projectRoot, "client", "dist", "index.html"));
}

export function getProjectRoot(): string {
  return projectRoot;
}
