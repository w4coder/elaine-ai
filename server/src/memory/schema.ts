import { db } from "../db/database.js";

export function runMemoryMigrations(): void {
  db.exec(`
    -- 1. Chat messages mirror (memory module's own copy)
    CREATE TABLE IF NOT EXISTS mem_chat_messages (
      id          TEXT PRIMARY KEY,
      chat_id     TEXT NOT NULL,
      role        TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_chat_messages_chat_created
      ON mem_chat_messages(chat_id, created_at);

    -- 2. Per-chat memory processing state
    CREATE TABLE IF NOT EXISTS mem_chat_memory_state (
      chat_id                    TEXT PRIMARY KEY,
      last_processed_message_id  TEXT,
      dirty                      INTEGER NOT NULL DEFAULT 0,
      locked_by_job              TEXT,
      lock_expires_at            TEXT,
      updated_at                 TEXT NOT NULL
    );

    -- 3. Episodes (condensed chat segments)
    CREATE TABLE IF NOT EXISTS mem_episodes (
      id                    TEXT PRIMARY KEY,
      chat_id               TEXT NOT NULL,
      from_message_id       TEXT NOT NULL,
      to_message_id         TEXT NOT NULL,
      summary               TEXT NOT NULL,
      entities              TEXT NOT NULL DEFAULT '[]',
      topics                TEXT NOT NULL DEFAULT '[]',
      outcome               TEXT,
      importance            REAL NOT NULL DEFAULT 0.5,
      created_at            TEXT NOT NULL,
      processed_for_notes   INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_mem_episodes_chat_created
      ON mem_episodes(chat_id, created_at);

    -- 4. Memory notes
    CREATE TABLE IF NOT EXISTS mem_memory_notes (
      id                  TEXT PRIMARY KEY,
      fingerprint         TEXT NOT NULL UNIQUE,
      scope               TEXT NOT NULL CHECK(scope IN ('chat', 'global')),
      chat_id             TEXT,
      user_id             TEXT NOT NULL,
      kind                TEXT NOT NULL CHECK(kind IN ('preference', 'project', 'fact', 'constraint', 'task')),
      summary             TEXT NOT NULL,
      confidence          REAL NOT NULL DEFAULT 0.8,
      stability           REAL NOT NULL DEFAULT 0.5,
      salience            REAL NOT NULL DEFAULT 1.0,
      status              TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'archived')),
      pinned_by_user      INTEGER NOT NULL DEFAULT 0,
      edited_by_user      INTEGER NOT NULL DEFAULT 0,
      source_episode_ids  TEXT NOT NULL DEFAULT '[]',
      embedding           TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_notes_user_scope_status
      ON mem_memory_notes(user_id, scope, status);

    CREATE INDEX IF NOT EXISTS idx_mem_notes_fingerprint
      ON mem_memory_notes(fingerprint);

    CREATE INDEX IF NOT EXISTS idx_mem_notes_user_status
      ON mem_memory_notes(user_id, status);

    -- 5. Memory blocks (pre-rendered context sections)
    CREATE TABLE IF NOT EXISTS mem_memory_blocks (
      id                   TEXT PRIMARY KEY,
      user_id              TEXT NOT NULL,
      chat_id              TEXT,
      kind                 TEXT NOT NULL CHECK(kind IN ('projects', 'preferences', 'constraints', 'active_tasks')),
      content              TEXT NOT NULL,
      built_from_note_ids  TEXT NOT NULL DEFAULT '[]',
      built_at             TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_blocks_user_kind_chat
      ON mem_memory_blocks(user_id, kind, COALESCE(chat_id, ''));

    -- 6. Memory jobs queue
    CREATE TABLE IF NOT EXISTS mem_memory_jobs (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL CHECK(kind IN ('build_episodes', 'extract_notes', 'rebuild_blocks', 'decay_salience')),
      user_id     TEXT NOT NULL,
      chat_id     TEXT,
      payload     TEXT NOT NULL DEFAULT '{}',
      status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed')),
      attempts    INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      created_at  TEXT NOT NULL,
      run_after   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_jobs_pending_run_after
      ON mem_memory_jobs(status, run_after)
      WHERE status = 'pending';
  `);
}
