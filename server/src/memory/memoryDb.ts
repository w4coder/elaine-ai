import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";
import { nowIso } from "../utils/time.js";
import type {
  HostMessage,
  ChatMemoryStateRow,
  EpisodeRow,
  MemoryNoteRow,
  MemoryBlockRow,
  MemoryJobRow,
  NoteKind,
  BlockKind,
  JobKind,
} from "./types.js";

// ─── Raw SQLite row types ─────────────────────────────────────────────────────

interface ChatMessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  created_at: string;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapChatMessage(row: ChatMessageRow): HostMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role as HostMessage["role"],
    content: row.content,
    createdAt: row.created_at,
  };
}

function mapNoteRow(row: MemoryNoteRow): MemoryNoteRow {
  return {
    ...row,
    source_episode_ids: row.source_episode_ids ?? "[]",
    embedding: row.embedding ?? null,
  };
}

function mapEpisodeRow(row: EpisodeRow): EpisodeRow {
  return row;
}

// ---------------------------------------------------------------------------
// Chat messages
// ---------------------------------------------------------------------------

export function insertChatMessage(msg: HostMessage): void {
  db.prepare(
    `INSERT OR IGNORE INTO mem_chat_messages (id, chat_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(msg.id, msg.chatId, msg.role, msg.content, msg.createdAt);
}

export function getUnprocessedMessages(
  chatId: string,
  afterMessageId: string | null,
  limit: number
): HostMessage[] {
  if (afterMessageId) {
    const cursor = db
      .prepare("SELECT created_at FROM mem_chat_messages WHERE id = ?")
      .get(afterMessageId) as { created_at: string } | undefined;

    if (!cursor) {
      // Cursor message not found — return nothing to be safe
      return [];
    }

    const rows = db
      .prepare(
        `SELECT * FROM mem_chat_messages
         WHERE chat_id = ? AND created_at > ?
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(chatId, cursor.created_at, limit) as ChatMessageRow[];

    return rows.map(mapChatMessage);
  }

  const rows = db
    .prepare(
      `SELECT * FROM mem_chat_messages
       WHERE chat_id = ?
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(chatId, limit) as ChatMessageRow[];

  return rows.map(mapChatMessage);
}

export function getRecentMessages(chatId: string, limit: number): HostMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM mem_chat_messages
       WHERE chat_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(chatId, limit) as ChatMessageRow[];

  return rows.map(mapChatMessage).reverse();
}

export function getChatIds(_userId: string): string[] {
  const rows = db
    .prepare("SELECT DISTINCT chat_id FROM mem_chat_messages ORDER BY chat_id")
    .all() as Array<{ chat_id: string }>;

  return rows.map((r) => r.chat_id);
}

/**
 * Copy messages from the host app's `messages` table into `mem_chat_messages`
 * for any conversations not yet mirrored. Returns the distinct chat IDs that
 * had new messages inserted.
 */
export function backfillExistingMessages(): string[] {
  // Find chat IDs in the host messages table that have at least one message
  // not yet in mem_chat_messages.
  const newRows = db
    .prepare(
      `INSERT OR IGNORE INTO mem_chat_messages (id, chat_id, role, content, created_at)
       SELECT m.id, m.conversation_id, m.role, m.content, m.created_at
       FROM messages m
       WHERE m.role IN ('user', 'assistant', 'tool')`
    )
    .run();

  if (newRows.changes === 0) {
    return [];
  }

  // Return distinct chat IDs that now have mirrored messages.
  const rows = db
    .prepare("SELECT DISTINCT chat_id FROM mem_chat_messages ORDER BY chat_id")
    .all() as Array<{ chat_id: string }>;

  return rows.map((r) => r.chat_id);
}

// ---------------------------------------------------------------------------
// Chat memory state
// ---------------------------------------------------------------------------

export function upsertChatMemoryState(
  chatId: string,
  patch: Partial<{
    lastProcessedMessageId: string;
    dirty: boolean;
    lockedByJob: string | null;
    lockExpiresAt: string | null;
  }>
): void {
  const now = nowIso();

  // Ensure row exists first
  db.prepare(
    `INSERT OR IGNORE INTO mem_chat_memory_state
       (chat_id, dirty, updated_at)
     VALUES (?, 0, ?)`
  ).run(chatId, now);

  const parts: string[] = ["updated_at = ?"];
  const values: unknown[] = [now];

  if (patch.lastProcessedMessageId !== undefined) {
    parts.push("last_processed_message_id = ?");
    values.push(patch.lastProcessedMessageId);
  }
  if (patch.dirty !== undefined) {
    parts.push("dirty = ?");
    values.push(patch.dirty ? 1 : 0);
  }
  if (patch.lockedByJob !== undefined) {
    parts.push("locked_by_job = ?");
    values.push(patch.lockedByJob);
  }
  if (patch.lockExpiresAt !== undefined) {
    parts.push("lock_expires_at = ?");
    values.push(patch.lockExpiresAt);
  }

  values.push(chatId);
  db.prepare(`UPDATE mem_chat_memory_state SET ${parts.join(", ")} WHERE chat_id = ?`).run(
    ...values
  );
}

export function getChatMemoryState(chatId: string): ChatMemoryStateRow | null {
  return (
    (db.prepare("SELECT * FROM mem_chat_memory_state WHERE chat_id = ?").get(chatId) as
      | ChatMemoryStateRow
      | undefined) ?? null
  );
}

export function getDirtyChats(): string[] {
  const now = nowIso();
  const rows = db
    .prepare(
      `SELECT chat_id FROM mem_chat_memory_state
       WHERE dirty = 1
         AND (lock_expires_at IS NULL OR lock_expires_at < ?)
       ORDER BY updated_at ASC`
    )
    .all(now) as Array<{ chat_id: string }>;

  return rows.map((r) => r.chat_id);
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

export function acquireLock(
  chatId: string,
  jobId: string,
  expiresInMs: number = 5 * 60 * 1000
): boolean {
  const now = nowIso();
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();

  // Ensure the state row exists
  db.prepare(
    `INSERT OR IGNORE INTO mem_chat_memory_state
       (chat_id, dirty, updated_at)
     VALUES (?, 0, ?)`
  ).run(chatId, now);

  // Atomically acquire the lock only if not already locked
  const result = db
    .prepare(
      `UPDATE mem_chat_memory_state
       SET locked_by_job = ?, lock_expires_at = ?, updated_at = ?
       WHERE chat_id = ?
         AND (locked_by_job IS NULL OR lock_expires_at < ?)`
    )
    .run(jobId, expiresAt, now, chatId, now);

  return result.changes > 0;
}

export function releaseLock(chatId: string): void {
  db.prepare(
    `UPDATE mem_chat_memory_state
     SET locked_by_job = NULL, lock_expires_at = NULL, updated_at = ?
     WHERE chat_id = ?`
  ).run(nowIso(), chatId);
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

export function insertEpisode(episode: Omit<EpisodeRow, "created_at">): void {
  db.prepare(
    `INSERT INTO mem_episodes
       (id, chat_id, from_message_id, to_message_id, summary, entities, topics,
        outcome, importance, created_at, processed_for_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    episode.id,
    episode.chat_id,
    episode.from_message_id,
    episode.to_message_id,
    episode.summary,
    typeof episode.entities === "string" ? episode.entities : JSON.stringify(episode.entities),
    typeof episode.topics === "string" ? episode.topics : JSON.stringify(episode.topics),
    episode.outcome ?? null,
    episode.importance,
    nowIso(),
    episode.processed_for_notes ?? 0
  );
}

export function getRecentEpisodes(limit: number = 20): EpisodeRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM mem_episodes
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as EpisodeRow[];
  return rows.map(mapEpisodeRow);
}

export function getUnprocessedEpisodes(chatId: string): EpisodeRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM mem_episodes
       WHERE chat_id = ? AND processed_for_notes = 0
       ORDER BY created_at ASC`
    )
    .all(chatId) as EpisodeRow[];

  return rows.map(mapEpisodeRow);
}

export function markEpisodesProcessed(episodeIds: string[]): void {
  if (episodeIds.length === 0) return;

  const placeholders = episodeIds.map(() => "?").join(", ");
  db.prepare(`UPDATE mem_episodes SET processed_for_notes = 1 WHERE id IN (${placeholders})`).run(
    ...episodeIds
  );
}

// ---------------------------------------------------------------------------
// Memory notes
// ---------------------------------------------------------------------------

export function insertNote(note: Omit<MemoryNoteRow, "created_at" | "updated_at">): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO mem_memory_notes
       (id, fingerprint, scope, chat_id, user_id, kind, summary,
        confidence, stability, salience, status, pinned_by_user, edited_by_user,
        source_episode_ids, embedding, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    note.id,
    note.fingerprint,
    note.scope,
    note.chat_id ?? null,
    note.user_id,
    note.kind,
    note.summary,
    note.confidence,
    note.stability,
    note.salience,
    note.status,
    note.pinned_by_user,
    note.edited_by_user,
    typeof note.source_episode_ids === "string"
      ? note.source_episode_ids
      : JSON.stringify(note.source_episode_ids),
    note.embedding ?? null,
    now,
    now
  );
}

export function getNoteByFingerprint(fingerprint: string): MemoryNoteRow | null {
  const row = db
    .prepare("SELECT * FROM mem_memory_notes WHERE fingerprint = ?")
    .get(fingerprint) as MemoryNoteRow | undefined;

  return row ? mapNoteRow(row) : null;
}

export function getActiveNotes(userId: string, limit: number = 200): MemoryNoteRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM mem_memory_notes
       WHERE user_id = ? AND status = 'active'
       ORDER BY salience DESC, updated_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as MemoryNoteRow[];

  return rows.map(mapNoteRow);
}

export function getActiveNotesByKind(userId: string, kind: NoteKind): MemoryNoteRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM mem_memory_notes
       WHERE user_id = ? AND kind = ? AND status = 'active'
       ORDER BY salience DESC, updated_at DESC`
    )
    .all(userId, kind) as MemoryNoteRow[];

  return rows.map(mapNoteRow);
}

export function getChatNotesForKind(
  userId: string,
  chatId: string,
  kind: NoteKind
): MemoryNoteRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM mem_memory_notes
       WHERE user_id = ? AND chat_id = ? AND kind = ? AND status = 'active'
       ORDER BY salience DESC, updated_at DESC`
    )
    .all(userId, chatId, kind) as MemoryNoteRow[];

  return rows.map(mapNoteRow);
}

export function getNoteById(id: string): MemoryNoteRow | null {
  const row = db.prepare("SELECT * FROM mem_memory_notes WHERE id = ?").get(id) as
    | MemoryNoteRow
    | undefined;
  return row ? mapNoteRow(row) : null;
}

export function updateNote(
  id: string,
  patch: Partial<{
    summary: string;
    confidence: number;
    stability: number;
    salience: number;
    status: string;
    scope: string;
    chatId: string | null;
    embedding: number[] | null;
    pinnedByUser: boolean;
    editedByUser: boolean;
  }>
): void {
  const now = nowIso();
  const parts: string[] = ["updated_at = ?"];
  const values: unknown[] = [now];

  if (patch.summary !== undefined) {
    parts.push("summary = ?");
    values.push(patch.summary);
  }
  if (patch.confidence !== undefined) {
    parts.push("confidence = ?");
    values.push(patch.confidence);
  }
  if (patch.stability !== undefined) {
    parts.push("stability = ?");
    values.push(patch.stability);
  }
  if (patch.salience !== undefined) {
    parts.push("salience = ?");
    values.push(patch.salience);
  }
  if (patch.status !== undefined) {
    parts.push("status = ?");
    values.push(patch.status);
  }
  if (patch.scope !== undefined) {
    parts.push("scope = ?");
    values.push(patch.scope);
  }
  if (patch.chatId !== undefined) {
    parts.push("chat_id = ?");
    values.push(patch.chatId ?? null);
  }
  if (patch.embedding !== undefined) {
    parts.push("embedding = ?");
    values.push(patch.embedding !== null ? JSON.stringify(patch.embedding) : null);
  }
  if (patch.pinnedByUser !== undefined) {
    parts.push("pinned_by_user = ?");
    values.push(patch.pinnedByUser ? 1 : 0);
  }
  if (patch.editedByUser !== undefined) {
    parts.push("edited_by_user = ?");
    values.push(patch.editedByUser ? 1 : 0);
  }

  values.push(id);
  db.prepare(`UPDATE mem_memory_notes SET ${parts.join(", ")} WHERE id = ?`).run(...values);
}

export function getChatNotesForScope(
  userId: string,
  scope: "chat" | "global",
  filters?: { minStability?: number; minConfidence?: number }
): MemoryNoteRow[] {
  const conditions: string[] = ["user_id = ?", "scope = ?", "status = 'active'"];
  const values: unknown[] = [userId, scope];

  if (filters?.minStability !== undefined) {
    conditions.push("stability >= ?");
    values.push(filters.minStability);
  }
  if (filters?.minConfidence !== undefined) {
    conditions.push("confidence >= ?");
    values.push(filters.minConfidence);
  }

  const rows = db
    .prepare(
      `SELECT * FROM mem_memory_notes
       WHERE ${conditions.join(" AND ")}
       ORDER BY salience DESC, updated_at DESC`
    )
    .all(...values) as MemoryNoteRow[];

  return rows.map(mapNoteRow);
}

export function countChatsWithNote(userId: string, kind: NoteKind, entities: string[]): number {
  // Find active notes matching user_id and kind, then count how many distinct chats
  // have summaries that mention any of the provided entities.
  if (entities.length === 0) {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT chat_id) as cnt FROM mem_memory_notes
         WHERE user_id = ? AND kind = ? AND status = 'active' AND chat_id IS NOT NULL`
      )
      .get(userId, kind) as { cnt: number };
    return row.cnt;
  }

  // We do a loose match: any note whose summary contains one of the entity strings
  const conditions = entities.map(() => "summary LIKE ?").join(" OR ");
  const likeValues = entities.map((e) => `%${e}%`);

  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT chat_id) as cnt FROM mem_memory_notes
       WHERE user_id = ? AND kind = ? AND status = 'active'
         AND chat_id IS NOT NULL
         AND (${conditions})`
    )
    .get(userId, kind, ...likeValues) as { cnt: number };

  return row.cnt;
}

// ---------------------------------------------------------------------------
// Memory blocks
// ---------------------------------------------------------------------------

export function upsertMemoryBlock(block: {
  userId: string;
  chatId: string | null;
  kind: BlockKind;
  content: string;
  builtFromNoteIds: string[];
}): void {
  const id = randomUUID();
  const now = nowIso();

  db.prepare(
    `INSERT INTO mem_memory_blocks
       (id, user_id, chat_id, kind, content, built_from_note_ids, built_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, kind, COALESCE(chat_id, ''))
     DO UPDATE SET
       content = excluded.content,
       built_from_note_ids = excluded.built_from_note_ids,
       built_at = excluded.built_at`
  ).run(
    id,
    block.userId,
    block.chatId ?? null,
    block.kind,
    block.content,
    JSON.stringify(block.builtFromNoteIds),
    now
  );
}

export function getMemoryBlocks(userId: string, chatId: string | null): MemoryBlockRow[] {
  if (chatId) {
    return db
      .prepare(
        `SELECT * FROM mem_memory_blocks
         WHERE user_id = ? AND (chat_id = ? OR chat_id IS NULL)
         ORDER BY built_at DESC`
      )
      .all(userId, chatId) as MemoryBlockRow[];
  }
  return db
    .prepare(
      `SELECT * FROM mem_memory_blocks
       WHERE user_id = ? AND chat_id IS NULL
       ORDER BY built_at DESC`
    )
    .all(userId) as MemoryBlockRow[];
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export function insertJob(job: {
  kind: JobKind;
  userId: string;
  chatId?: string | null;
  payload?: Record<string, unknown>;
  runAfter?: string;
}): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO mem_memory_jobs
       (id, kind, user_id, chat_id, payload, status, attempts, created_at, run_after)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).run(
    randomUUID(),
    job.kind,
    job.userId,
    job.chatId ?? null,
    JSON.stringify(job.payload ?? {}),
    now,
    job.runAfter ?? now
  );
}

export function getRecentJobs(limit: number = 10): MemoryJobRow[] {
  return db
    .prepare(
      `SELECT * FROM mem_memory_jobs
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as MemoryJobRow[];
}

export function getNextPendingJob(): MemoryJobRow | null {
  const now = nowIso();
  return (
    (db
      .prepare(
        `SELECT * FROM mem_memory_jobs
         WHERE status = 'pending' AND run_after <= ?
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(now) as MemoryJobRow | undefined) ?? null
  );
}

export function claimJob(jobId: string): boolean {
  const result = db
    .prepare(
      `UPDATE mem_memory_jobs
       SET status = 'running', attempts = attempts + 1
       WHERE id = ? AND status = 'pending'`
    )
    .run(jobId);

  return result.changes > 0;
}

export function completeJob(jobId: string): void {
  db.prepare("UPDATE mem_memory_jobs SET status = 'done' WHERE id = ?").run(jobId);
}

export function failJob(jobId: string, error: string, retryAfterMs: number = 60_000): void {
  const row = db.prepare("SELECT attempts FROM mem_memory_jobs WHERE id = ?").get(jobId) as
    | { attempts: number }
    | undefined;

  if (!row) return;

  if (row.attempts < 3) {
    const retryAt = new Date(Date.now() + retryAfterMs).toISOString();
    db.prepare(
      `UPDATE mem_memory_jobs
       SET status = 'pending', error = ?, run_after = ?
       WHERE id = ?`
    ).run(error, retryAt, jobId);
  } else {
    db.prepare("UPDATE mem_memory_jobs SET status = 'failed', error = ? WHERE id = ?").run(
      error,
      jobId
    );
  }
}
