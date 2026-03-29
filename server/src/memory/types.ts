// ---------------------------------------------------------------------------
// Core message / adapter types
// ---------------------------------------------------------------------------

export interface HostMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
}

export interface ChatHistoryAdapter {
  /** Return messages for a chat, optionally after a cursor message id. */
  getMessages(
    chatId: string,
    afterMessageId?: string | null,
    limit?: number
  ): Promise<HostMessage[]>;
  /** Return all chat ids this adapter knows about. */
  getChatIds(): Promise<string[]>;
  /** Register a listener that fires whenever a new message arrives. */
  onMessage(handler: (msg: HostMessage) => void): void;
}

// ---------------------------------------------------------------------------
// Module configuration
// ---------------------------------------------------------------------------

export interface MemoryModuleConfig {
  /** Unused — module uses the shared `db` singleton from ../db/database.js */
  databaseUrl?: string;
  /** Async function that returns an embedding vector for a piece of text. */
  embed?: ((text: string) => Promise<number[]>) | null;
  /** Async function that calls the LLM and returns its text response. */
  llm: (prompt: string) => Promise<string>;
  /** The chat history adapter wired to the host app's message store. */
  adapter: ChatHistoryAdapter;
  options?: {
    jobIntervalMs?: number;
    episodeMinMessages?: number;
    episodeChunkSize?: number;
    decayIntervalMs?: number;
  };
}

export interface MemoryModule {
  /** Run migrations and wire up adapter listeners. */
  init(config: MemoryModuleConfig): Promise<void>;
  /** Start background job runner. Returns a stop function. */
  start(userId: string): () => void;
  /** Build and return a context string for the given query. */
  query(params: { userId: string; chatId: string; currentMessage: string }): Promise<string>;
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

export interface EpisodeRow {
  id: string;
  chat_id: string;
  from_message_id: string;
  to_message_id: string;
  summary: string;
  entities: string; // JSON string[]
  topics: string; // JSON string[]
  outcome: string | null;
  importance: number;
  created_at: string;
  processed_for_notes: number; // 0 | 1
}

export interface MemoryNoteRow {
  id: string;
  fingerprint: string;
  scope: "chat" | "global";
  chat_id: string | null;
  user_id: string;
  kind: NoteKind;
  summary: string;
  confidence: number;
  stability: number;
  salience: number;
  status: "active" | "superseded" | "archived";
  pinned_by_user: number; // 0 | 1
  edited_by_user: number; // 0 | 1
  source_episode_ids: string; // JSON string[]
  embedding: string | null; // JSON number[]
  created_at: string;
  updated_at: string;
}

export interface MemoryBlockRow {
  id: string;
  user_id: string;
  chat_id: string | null;
  kind: BlockKind;
  content: string;
  built_from_note_ids: string; // JSON string[]
  built_at: string;
}

export interface MemoryJobRow {
  id: string;
  kind: JobKind;
  user_id: string;
  chat_id: string | null;
  payload: string; // JSON object
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  error: string | null;
  created_at: string;
  run_after: string;
}

export interface ChatMemoryStateRow {
  chat_id: string;
  last_processed_message_id: string | null;
  dirty: number; // 0 | 1
  locked_by_job: string | null;
  lock_expires_at: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Derived / enum-like types
// ---------------------------------------------------------------------------

export type NoteKind = "preference" | "project" | "fact" | "constraint" | "task";
export type NoteScope = "chat" | "global";
export type BlockKind = "projects" | "preferences" | "constraints" | "active_tasks";
export type JobKind = "build_episodes" | "extract_notes" | "rebuild_blocks" | "decay_salience";

// ---------------------------------------------------------------------------
// LLM extraction result types
// ---------------------------------------------------------------------------

export type NoteActionType = "create" | "update" | "supersede" | "skip";

export interface NoteAction {
  action: NoteActionType;
  kind: NoteKind;
  scope: NoteScope;
  summary: string;
  entities: string[];
  confidence: number;
  stability: number;
  /** If action is "update" or "supersede", the fingerprint of the existing note. */
  targetFingerprint?: string | null;
}

export interface EpisodeData {
  summary: string;
  entities: string[];
  topics: string[];
  outcome: string | null;
  importance: number;
}
