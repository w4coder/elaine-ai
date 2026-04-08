import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { getDefaultSettings } from "../utils/constants.js";
import { nowIso } from "../utils/time.js";
import { MASKED, decryptApiKey, encryptApiKey, isEncrypted } from "../utils/crypto.js";
import { notifyMemoryOfMessage } from "../memory/index.js";
import type {
  AppNotification,
  AppSettings,
  ChannelConnection,
  ChannelId,
  PendingChannelMessage,
  ChannelSenderPermission,
  ChannelSenderStatus,
  ConversationDetail,
  ConversationRecord,
  ConversationSummary,
  MessageRecord,
  PendingInteraction,
  ProviderType,
  ScheduledJob,
  UserModel,
  UserModelRecord,
  TitleSource,
  TitleStatus,
  UserProfile,
} from "../types.js";

// ─── Raw SQLite row types ─────────────────────────────────────────────────────

interface ConversationRow {
  id: string;
  title: string;
  title_status: string;
  title_source: string;
  profile_id: string;
  provider_type: string;
  model: string;
  system_prompt: string;
  workspace_path: string | null;
  conversation_type: string;
  created_at: string;
  updated_at: string;
}

interface ConversationSummaryRow extends ConversationRow {
  preview: string;
  message_count: number | string;
  last_message_at: string | null;
}

interface ConversationSearchRow {
  conversation_id: string;
  title: string;
  updated_at: string;
  message_id: string;
  role: string;
  content: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  metadata: string | null;
  created_at: string;
}

interface UserModelRow {
  id: string;
  profile_id: string;
  model: string;
  created_at: string;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapConversationRow(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    titleStatus: row.title_status as ConversationRecord["titleStatus"],
    titleSource: row.title_source as ConversationRecord["titleSource"],
    profileId: row.profile_id,
    providerType: row.provider_type as ConversationRecord["providerType"],
    model: row.model,
    systemPrompt: row.system_prompt,
    workspacePath: row.workspace_path,
    conversationType: (row.conversation_type ?? "chat") as "chat" | "schedule",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessageRow(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRecord["role"],
    content: row.content,
    toolName: row.tool_name,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
  };
}

function mapUserModelRow(row: UserModelRow): UserModelRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    model: row.model,
    createdAt: row.created_at,
  };
}

/** Read raw settings from DB (API keys may be encrypted blobs). */
function getRawSettings(): AppSettings | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("app_settings") as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as AppSettings) : null;
}

/**
 * Returns settings with API keys decrypted — use for internal services / adapters.
 * Never send this directly to the client.
 */
export function getSettings(): AppSettings {
  const raw = getRawSettings();
  if (!raw) {
    const defaults = getDefaultSettings();
    saveSettings(defaults);
    return defaults;
  }
  // Migrate legacy `connections` field → `channels`
  const rawChannels =
    raw.channels ??
    ((raw as unknown as Record<string, unknown>)["connections"] as AppSettings["channels"]);
  const decryptedChannels: AppSettings["channels"] = rawChannels
    ? Object.fromEntries(
        Object.entries(rawChannels).map(([id, cfg]) => [
          id,
          {
            ...cfg,
            clientSecret: cfg.clientSecret ? decryptApiKey(cfg.clientSecret) : cfg.clientSecret,
          },
        ])
      )
    : undefined;
  return {
    ...raw,
    profiles: raw.profiles.map((p) => ({
      ...p,
      apiKey: p.apiKey ? decryptApiKey(p.apiKey) : p.apiKey,
    })),
    channels: decryptedChannels,
  };
}

/**
 * Returns settings with API keys replaced by the MASKED sentinel — safe to send to the client.
 */
export function getSettingsForClient(): AppSettings {
  const settings = getSettings();
  const maskedChannels: AppSettings["channels"] = settings.channels
    ? Object.fromEntries(
        Object.entries(settings.channels).map(([id, cfg]) => [
          id,
          { ...cfg, clientSecret: cfg.clientSecret ? MASKED : cfg.clientSecret },
        ])
      )
    : undefined;
  return {
    ...settings,
    profiles: settings.profiles.map((p) => ({
      ...p,
      apiKey: p.apiKey ? MASKED : p.apiKey,
    })),
    channels: maskedChannels,
  };
}

/**
 * Saves settings. Handles the MASKED sentinel (keep existing key) and encrypts new keys.
 * Returns the client-safe (masked) version.
 */
export function saveSettings(incoming: AppSettings): AppSettings {
  const existing = getRawSettings();

  const processedProfiles = incoming.profiles.map((p) => {
    const existingProfile = existing?.profiles.find((e) => e.id === p.id);

    let apiKey = p.apiKey;
    if (apiKey === MASKED) {
      // Client didn't change the key — keep whatever is stored
      apiKey = existingProfile?.apiKey ?? "";
    } else if (apiKey && !isEncrypted(apiKey)) {
      // New plain-text key — encrypt before storing
      apiKey = encryptApiKey(apiKey);
    }
    return { ...p, apiKey };
  });

  // Handle channel clientSecrets (same MASKED pattern as apiKey)
  const processedChannels: AppSettings["channels"] = incoming.channels
    ? Object.fromEntries(
        Object.entries(incoming.channels).map(([id, cfg]) => {
          const legacyConnections = (existing as Record<string, unknown> | null)?.[
            "connections"
          ] as AppSettings["channels"] | undefined;
          const existingSecret =
            existing?.channels?.[id as ChannelId]?.clientSecret ??
            legacyConnections?.[id as ChannelId]?.clientSecret;
          let clientSecret = cfg.clientSecret;
          if (clientSecret === MASKED) {
            clientSecret = existingSecret ?? "";
          } else if (clientSecret && !isEncrypted(clientSecret)) {
            clientSecret = encryptApiKey(clientSecret);
          }
          return [id, { ...cfg, clientSecret }];
        })
      )
    : incoming.channels;

  const toStore: AppSettings = {
    ...incoming,
    profiles: processedProfiles,
    channels: processedChannels,
  };

  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run("app_settings", JSON.stringify(toStore));

  return getSettingsForClient();
}

export function getUserProfile(): UserProfile | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("user_profile") as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as UserProfile) : null;
}

export function saveUserProfile(profile: UserProfile): UserProfile {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run("user_profile", JSON.stringify(profile));
  return profile;
}

export function listUserModels(profileId?: string): UserModel[] {
  const rows = profileId
    ? db
        .prepare(
          "SELECT * FROM user_models WHERE profile_id = ? ORDER BY created_at ASC, model COLLATE NOCASE ASC"
        )
        .all(profileId)
    : db
        .prepare("SELECT * FROM user_models ORDER BY created_at ASC, model COLLATE NOCASE ASC")
        .all();
  const settings = getSettings();
  const profileMap = new Map(settings.profiles.map((profile) => [profile.id, profile]));

  return (rows as UserModelRow[]).map(mapUserModelRow).flatMap((entry) => {
    const profile = profileMap.get(entry.profileId);
    if (!profile) {
      return [];
    }

    return [
      {
        ...entry,
        profileName: profile.name,
        providerType: profile.providerType,
      },
    ];
  });
}

export function createUserModel(input: { profileId: string; model: string }): UserModel {
  const settings = getSettings();
  const profile = settings.profiles.find((entry) => entry.id === input.profileId);
  if (!profile) {
    throw new Error(`Provider profile not found: ${input.profileId}`);
  }

  const model = input.model.trim();
  if (!model) {
    throw new Error("Model is required.");
  }

  const existing = db
    .prepare("SELECT * FROM user_models WHERE profile_id = ? AND model = ?")
    .get(input.profileId, model) as UserModelRow | undefined;

  if (existing) {
    const entry = mapUserModelRow(existing);
    return {
      ...entry,
      profileName: profile.name,
      providerType: profile.providerType,
    };
  }

  const record: UserModelRecord = {
    id: randomUUID(),
    profileId: input.profileId,
    model,
    createdAt: nowIso(),
  };

  db.prepare("INSERT INTO user_models (id, profile_id, model, created_at) VALUES (?, ?, ?, ?)").run(
    record.id,
    record.profileId,
    record.model,
    record.createdAt
  );

  return {
    ...record,
    profileName: profile.name,
    providerType: profile.providerType,
  };
}

export function deleteUserModel(id: string): void {
  db.prepare("DELETE FROM user_models WHERE id = ?").run(id);
}

export function listConversations(): ConversationSummary[] {
  const rows = db
    .prepare(
      `SELECT
      c.*,
      COALESCE((SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1), '') AS preview,
      COALESCE((SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id), 0) AS message_count,
      (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at
     FROM conversations c
     ORDER BY c.updated_at DESC`
    )
    .all() as ConversationSummaryRow[];

  return rows.map((row) => ({
    ...mapConversationRow(row),
    preview: row.preview,
    messageCount: Number(row.message_count ?? 0),
    lastMessageAt: row.last_message_at ?? null,
  }));
}

export function getConversationSummary(id: string): ConversationSummary | null {
  const row = db
    .prepare(
      `SELECT
      c.*,
      COALESCE((SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1), '') AS preview,
      COALESCE((SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id), 0) AS message_count,
      (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at
     FROM conversations c
     WHERE c.id = ?`
    )
    .get(id) as ConversationSummaryRow | undefined;

  if (!row) {
    return null;
  }

  return {
    ...mapConversationRow(row),
    preview: row.preview,
    messageCount: Number(row.message_count ?? 0),
    lastMessageAt: row.last_message_at ?? null,
  };
}

export function getConversation(id: string): ConversationDetail | null {
  const row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
    | ConversationRow
    | undefined;
  if (!row) {
    return null;
  }

  const messages = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(id) as MessageRow[];

  const pendingRow = db
    .prepare("SELECT type, payload FROM pending_interaction WHERE conversation_id = ?")
    .get(id) as { type: string; payload: string } | undefined;

  const pendingInteraction: PendingInteraction | null = pendingRow
    ? {
        type: pendingRow.type as PendingInteraction["type"],
        payload: JSON.parse(pendingRow.payload),
      }
    : null;

  return {
    ...mapConversationRow(row),
    messages: messages.map(mapMessageRow),
    pendingInteraction,
  };
}

export function savePendingInteraction(
  conversationId: string,
  type: PendingInteraction["type"],
  payload: Record<string, unknown>
): void {
  db.prepare(
    `
    INSERT INTO pending_interaction (conversation_id, type, payload, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET type = excluded.type, payload = excluded.payload, created_at = excluded.created_at
  `
  ).run(conversationId, type, JSON.stringify(payload), nowIso());
}

export function clearPendingInteraction(conversationId: string): void {
  db.prepare("DELETE FROM pending_interaction WHERE conversation_id = ?").run(conversationId);
}

export function createConversation(input: {
  title?: string;
  titleSource?: "placeholder" | "generated" | "manual";
  profileId: string;
  providerType: ProviderType;
  model: string;
  systemPrompt: string;
  workspacePath?: string | null;
  conversationType?: "chat" | "schedule" | "scheduled_run";
}): ConversationRecord {
  const timestamp = nowIso();
  const conversation: ConversationRecord = {
    id: randomUUID(),
    title: input.title?.trim() || "New conversation",
    titleStatus: "idle",
    titleSource: input.titleSource ?? "placeholder",
    profileId: input.profileId,
    providerType: input.providerType,
    model: input.model,
    systemPrompt: input.systemPrompt,
    workspacePath: input.workspacePath?.trim() || null,
    conversationType: input.conversationType ?? "chat",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.prepare(
    `INSERT INTO conversations (
      id, title, title_status, title_source, profile_id, provider_type, model, system_prompt, workspace_path, conversation_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    conversation.id,
    conversation.title,
    conversation.titleStatus,
    conversation.titleSource,
    conversation.profileId,
    conversation.providerType,
    conversation.model,
    conversation.systemPrompt,
    conversation.workspacePath,
    conversation.conversationType,
    conversation.createdAt,
    conversation.updatedAt
  );

  return conversation;
}

export function updateConversation(
  id: string,
  patch: Partial<{
    title: string;
    titleStatus: TitleStatus;
    titleSource: TitleSource;
    profileId: string;
    providerType: ProviderType;
    model: string;
    systemPrompt: string;
    workspacePath: string | null;
  }>
): ConversationRecord | null {
  const current = getConversation(id);
  if (!current) {
    return null;
  }

  const updated: ConversationRecord = {
    ...current,
    title: patch.title ?? current.title,
    titleStatus: patch.titleStatus ?? current.titleStatus,
    titleSource: patch.titleSource ?? current.titleSource,
    profileId: patch.profileId ?? current.profileId,
    providerType: patch.providerType ?? current.providerType,
    model: patch.model ?? current.model,
    systemPrompt: patch.systemPrompt ?? current.systemPrompt,
    workspacePath: patch.workspacePath === undefined ? current.workspacePath : patch.workspacePath,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };

  db.prepare(
    `UPDATE conversations
     SET title = ?, title_status = ?, title_source = ?, profile_id = ?, provider_type = ?, model = ?, system_prompt = ?, workspace_path = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    updated.title,
    updated.titleStatus,
    updated.titleSource,
    updated.profileId,
    updated.providerType,
    updated.model,
    updated.systemPrompt,
    updated.workspacePath,
    updated.updatedAt,
    id
  );

  return updated;
}

export function deleteConversation(id: string): void {
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

export function createMessage(input: {
  conversationId: string;
  role: MessageRecord["role"];
  content: string;
  toolName?: string | null;
  metadata?: Record<string, unknown> | null;
}): MessageRecord {
  const message: MessageRecord = {
    id: randomUUID(),
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    toolName: input.toolName ?? null,
    metadata: input.metadata ?? null,
    createdAt: nowIso(),
  };

  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, tool_name, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    message.id,
    message.conversationId,
    message.role,
    message.content,
    message.toolName,
    message.metadata ? JSON.stringify(message.metadata) : null,
    message.createdAt
  );

  touchConversation(input.conversationId);

  // Notify memory module (fire-and-forget; only for user/assistant/tool roles)
  if (message.role === "user" || message.role === "assistant" || message.role === "tool") {
    notifyMemoryOfMessage({
      id: message.id,
      chatId: message.conversationId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    });
  }

  return message;
}

export function updateMessage(
  id: string,
  patch: Partial<{
    content: string;
    metadata: Record<string, unknown> | null;
  }>
): void {
  const current = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
    | MessageRow
    | undefined;
  if (!current) {
    return;
  }

  db.prepare("UPDATE messages SET content = ?, metadata = ? WHERE id = ?").run(
    patch.content ?? current.content,
    JSON.stringify(patch.metadata ?? (current.metadata ? JSON.parse(current.metadata) : null)),
    id
  );
}

export function deleteMessage(id: string): void {
  db.prepare("DELETE FROM messages WHERE id = ?").run(id);
}

export function deleteMessagesFromId(messageId: string): void {
  db.prepare(
    "DELETE FROM messages WHERE conversation_id = (SELECT conversation_id FROM messages WHERE id = ?) AND rowid >= (SELECT rowid FROM messages WHERE id = ?)"
  ).run(messageId, messageId);
}

export function touchConversation(id: string): void {
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(nowIso(), id);
}

export function listMessages(conversationId: string): MessageRecord[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(conversationId) as MessageRow[];

  return rows.map(mapMessageRow);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function summarizeSnippet(content: string, query: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= 220) {
    return compact;
  }

  const queryIndex = compact.toLowerCase().indexOf(query);
  if (queryIndex < 0) {
    return `${compact.slice(0, 217)}...`;
  }

  const start = Math.max(0, queryIndex - 80);
  const end = Math.min(compact.length, queryIndex + 140);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compact.length ? "..." : "";
  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

function scoreConversationSearchRow(
  row: ConversationSearchRow,
  query: string,
  terms: string[]
): number {
  const title = row.title.toLowerCase();
  const content = row.content.toLowerCase();

  let score = 0;
  if (title.includes(query)) score += 1.2;
  if (content.includes(query)) score += 1.5;

  for (const term of terms) {
    if (title.includes(term)) score += 0.25;
    if (content.includes(term)) score += 0.15;
  }

  const ageDays = Math.max(0, (Date.now() - new Date(row.updated_at).getTime()) / 86_400_000);
  score += Math.exp(-ageDays / 45) * 0.2;

  return score;
}

export function listConversationSearchResults(
  query: string,
  limit: number = 5
): Array<{
  conversationId: string;
  title: string;
  updatedAt: string;
  messageId: string;
  role: "user" | "assistant";
  snippet: string;
  score: number;
}> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const terms = [...new Set(normalizedQuery.split(/\s+/).filter((term) => term.length >= 3))].slice(
    0,
    6
  );
  const searchTerms = [normalizedQuery, ...terms];
  const clauses = searchTerms.map(
    () => "(LOWER(c.title) LIKE ? ESCAPE '\\' OR LOWER(m.content) LIKE ? ESCAPE '\\')"
  );
  const params = searchTerms.flatMap((term) => {
    const pattern = `%${escapeLike(term)}%`;
    return [pattern, pattern];
  });

  const rows = db
    .prepare(
      `SELECT
         c.id AS conversation_id,
         c.title AS title,
         c.updated_at AS updated_at,
         m.id AS message_id,
         m.role AS role,
         m.content AS content
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.role IN ('user', 'assistant')
         AND (${clauses.join(" OR ")})
       ORDER BY c.updated_at DESC, m.created_at DESC
       LIMIT 200`
    )
    .all(...params) as ConversationSearchRow[];

  return rows
    .map((row) => ({
      conversationId: row.conversation_id,
      title: row.title,
      updatedAt: row.updated_at,
      messageId: row.message_id,
      role: row.role as "user" | "assistant",
      snippet: summarizeSnippet(row.content, normalizedQuery),
      score: scoreConversationSearchRow(row, normalizedQuery, terms),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────

interface ScheduledJobRow {
  id: string;
  conversation_id: string;
  title: string;
  description: string;
  user_prompt: string;
  profile_id: string;
  model: string;
  interval_ms: number;
  enabled: number;
  max_runs: number | null;
  run_count: number;
  last_run_at: string | null;
  last_run_conversation_id: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

function mapScheduledJobRow(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    title: row.title,
    description: row.description,
    userPrompt: row.user_prompt,
    profileId: row.profile_id,
    model: row.model,
    intervalMs: row.interval_ms,
    enabled: row.enabled === 1,
    maxRuns: row.max_runs,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
    lastRunConversationId: row.last_run_conversation_id,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listScheduledJobs(): ScheduledJob[] {
  const rows = db
    .prepare("SELECT * FROM scheduled_jobs ORDER BY created_at DESC")
    .all() as ScheduledJobRow[];
  return rows.map(mapScheduledJobRow);
}

export function getScheduledJob(id: string): ScheduledJob | null {
  const row = db.prepare("SELECT * FROM scheduled_jobs WHERE id = ?").get(id) as
    | ScheduledJobRow
    | undefined;
  return row ? mapScheduledJobRow(row) : null;
}

export function getDueScheduledJobs(): ScheduledJob[] {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM scheduled_jobs
       WHERE enabled = 1
         AND next_run_at <= ?
         AND (max_runs IS NULL OR run_count < max_runs)`
    )
    .all(now) as ScheduledJobRow[];
  return rows.map(mapScheduledJobRow);
}

export function createScheduledJob(input: {
  conversationId: string;
  title: string;
  description: string;
  userPrompt: string;
  profileId: string;
  model: string;
  intervalMs: number;
  enabled?: boolean;
  maxRuns?: number | null;
  nextRunAt: string;
}): ScheduledJob {
  const timestamp = nowIso();
  const row: ScheduledJobRow = {
    id: randomUUID(),
    conversation_id: input.conversationId,
    title: input.title,
    description: input.description,
    user_prompt: input.userPrompt,
    profile_id: input.profileId,
    model: input.model,
    interval_ms: input.intervalMs,
    enabled: (input.enabled ?? true) ? 1 : 0,
    max_runs: input.maxRuns ?? null,
    run_count: 0,
    last_run_at: null,
    last_run_conversation_id: null,
    next_run_at: input.nextRunAt,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prepare(
    `INSERT INTO scheduled_jobs (
      id, conversation_id, title, description, user_prompt, profile_id, model,
      interval_ms, enabled, max_runs, run_count, last_run_at, next_run_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.conversation_id,
    row.title,
    row.description,
    row.user_prompt,
    row.profile_id,
    row.model,
    row.interval_ms,
    row.enabled,
    row.max_runs,
    row.run_count,
    row.last_run_at,
    row.next_run_at,
    row.created_at,
    row.updated_at
  );

  return mapScheduledJobRow(row);
}

export function updateScheduledJob(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    userPrompt: string;
    intervalMs: number;
    enabled: boolean;
    maxRuns: number | null;
    runCount: number;
    lastRunAt: string | null;
    lastRunConversationId: string | null;
    nextRunAt: string;
  }>
): ScheduledJob | null {
  const current = getScheduledJob(id);
  if (!current) return null;

  const updated = {
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    user_prompt: patch.userPrompt ?? current.userPrompt,
    interval_ms: patch.intervalMs ?? current.intervalMs,
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : current.enabled ? 1 : 0,
    max_runs: patch.maxRuns !== undefined ? patch.maxRuns : current.maxRuns,
    run_count: patch.runCount ?? current.runCount,
    last_run_at: patch.lastRunAt !== undefined ? patch.lastRunAt : current.lastRunAt,
    last_run_conversation_id:
      patch.lastRunConversationId !== undefined
        ? patch.lastRunConversationId
        : current.lastRunConversationId,
    next_run_at: patch.nextRunAt ?? current.nextRunAt,
    updated_at: nowIso(),
  };

  db.prepare(
    `UPDATE scheduled_jobs
     SET title = ?, description = ?, user_prompt = ?, interval_ms = ?,
         enabled = ?, max_runs = ?, run_count = ?, last_run_at = ?,
         last_run_conversation_id = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    updated.title,
    updated.description,
    updated.user_prompt,
    updated.interval_ms,
    updated.enabled,
    updated.max_runs,
    updated.run_count,
    updated.last_run_at,
    updated.last_run_conversation_id,
    updated.next_run_at,
    updated.updated_at,
    id
  );

  return getScheduledJob(id);
}

export function deleteScheduledJob(id: string): void {
  db.prepare("DELETE FROM scheduled_jobs WHERE id = ?").run(id);
}

// ─── App Notifications ────────────────────────────────────────────────────────

interface AppNotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  target_url: string | null;
  metadata: string | null;
  read: number;
  created_at: string;
}

function mapNotificationRow(row: AppNotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    targetUrl: row.target_url,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

export function listNotifications(opts?: {
  limit?: number;
  unreadOnly?: boolean;
}): AppNotification[] {
  const limit = opts?.limit ?? 100;
  const rows = opts?.unreadOnly
    ? db
        .prepare("SELECT * FROM app_notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?")
        .all(limit)
    : db.prepare("SELECT * FROM app_notifications ORDER BY created_at DESC LIMIT ?").all(limit);
  return (rows as AppNotificationRow[]).map(mapNotificationRow);
}

export function getNotification(id: string): AppNotification | null {
  const row = db.prepare("SELECT * FROM app_notifications WHERE id = ?").get(id) as
    | AppNotificationRow
    | undefined;
  return row ? mapNotificationRow(row) : null;
}

export function createNotification(data: {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  targetUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}): AppNotification {
  const now = nowIso();
  db.prepare(
    "INSERT INTO app_notifications (id, type, title, body, target_url, metadata, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)"
  ).run(
    data.id,
    data.type,
    data.title,
    data.body ?? null,
    data.targetUrl ?? null,
    data.metadata ? JSON.stringify(data.metadata) : null,
    now
  );
  return getNotification(data.id)!;
}

interface ChannelSenderPermissionRow {
  connection_id: string;
  channel_id: string;
  sender_id: string;
  sender_name: string | null;
  status: string;
  decided_at: string;
  created_at: string;
  updated_at: string;
}

function mapChannelSenderPermissionRow(row: ChannelSenderPermissionRow): ChannelSenderPermission {
  return {
    connectionId: row.connection_id,
    channelId: row.channel_id as ChannelId,
    senderId: row.sender_id,
    senderName: row.sender_name,
    status: row.status as ChannelSenderStatus,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface PendingChannelMessageRow {
  id: string;
  connection_id: string;
  channel_id: string;
  sender_id: string;
  sender_name: string | null;
  reply_target_id: string;
  text: string;
  created_at: string;
}

function mapPendingChannelMessageRow(row: PendingChannelMessageRow): PendingChannelMessage {
  return {
    id: row.id,
    connectionId: row.connection_id,
    channelId: row.channel_id as ChannelId,
    senderId: row.sender_id,
    senderName: row.sender_name,
    replyTargetId: row.reply_target_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

export function listChannelSenderPermissions(connectionId?: string): ChannelSenderPermission[] {
  const rows = connectionId
    ? db
        .prepare(
          `SELECT * FROM channel_sender_permissions
           WHERE connection_id = ?
           ORDER BY updated_at DESC, sender_name COLLATE NOCASE ASC, sender_id ASC`
        )
        .all(connectionId)
    : db
        .prepare(
          `SELECT * FROM channel_sender_permissions
           ORDER BY updated_at DESC, sender_name COLLATE NOCASE ASC, sender_id ASC`
        )
        .all();

  return (rows as ChannelSenderPermissionRow[]).map(mapChannelSenderPermissionRow);
}

export function getChannelSenderPermission(
  connectionId: string,
  senderId: string
): ChannelSenderPermission | null {
  const row = db
    .prepare("SELECT * FROM channel_sender_permissions WHERE connection_id = ? AND sender_id = ?")
    .get(connectionId, senderId) as ChannelSenderPermissionRow | undefined;
  return row ? mapChannelSenderPermissionRow(row) : null;
}

export function upsertChannelSenderPermission(data: {
  connectionId: string;
  channelId: ChannelId;
  senderId: string;
  senderName: string | null;
  status: ChannelSenderStatus;
}): ChannelSenderPermission {
  const now = nowIso();
  const existing = getChannelSenderPermission(data.connectionId, data.senderId);
  db.prepare(
    `INSERT INTO channel_sender_permissions
       (connection_id, channel_id, sender_id, sender_name, status, decided_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connection_id, sender_id) DO UPDATE SET
       sender_name = excluded.sender_name,
       status = excluded.status,
       decided_at = excluded.decided_at,
       updated_at = excluded.updated_at`
  ).run(
    data.connectionId,
    data.channelId,
    data.senderId,
    data.senderName,
    data.status,
    now,
    existing?.createdAt ?? now,
    now
  );

  return getChannelSenderPermission(data.connectionId, data.senderId)!;
}

export function deleteChannelSenderPermission(connectionId: string, senderId: string): void {
  db.prepare(
    "DELETE FROM channel_sender_permissions WHERE connection_id = ? AND sender_id = ?"
  ).run(connectionId, senderId);
}

export function createPendingChannelMessage(data: {
  id: string;
  connectionId: string;
  channelId: ChannelId;
  senderId: string;
  senderName: string | null;
  replyTargetId: string;
  text: string;
  createdAt: string;
}): PendingChannelMessage {
  db.prepare(
    `INSERT INTO channel_pending_messages
       (id, connection_id, channel_id, sender_id, sender_name, reply_target_id, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id,
    data.connectionId,
    data.channelId,
    data.senderId,
    data.senderName,
    data.replyTargetId,
    data.text,
    data.createdAt
  );

  return {
    id: data.id,
    connectionId: data.connectionId,
    channelId: data.channelId,
    senderId: data.senderId,
    senderName: data.senderName,
    replyTargetId: data.replyTargetId,
    text: data.text,
    createdAt: data.createdAt,
  };
}

export function listPendingChannelMessages(
  connectionId: string,
  senderId?: string
): PendingChannelMessage[] {
  const rows = senderId
    ? db
        .prepare(
          `SELECT * FROM channel_pending_messages
           WHERE connection_id = ? AND sender_id = ?
           ORDER BY created_at ASC`
        )
        .all(connectionId, senderId)
    : db
        .prepare(
          `SELECT * FROM channel_pending_messages
           WHERE connection_id = ?
           ORDER BY created_at ASC`
        )
        .all(connectionId);

  return (rows as PendingChannelMessageRow[]).map(mapPendingChannelMessageRow);
}

export function deletePendingChannelMessage(id: string): void {
  db.prepare("DELETE FROM channel_pending_messages WHERE id = ?").run(id);
}

export function deletePendingChannelMessagesForSender(
  connectionId: string,
  senderId: string
): void {
  db.prepare("DELETE FROM channel_pending_messages WHERE connection_id = ? AND sender_id = ?").run(
    connectionId,
    senderId
  );
}

export function markNotificationRead(id: string, read = true): void {
  db.prepare("UPDATE app_notifications SET read = ? WHERE id = ?").run(read ? 1 : 0, id);
}

export function markAllNotificationsRead(): void {
  db.prepare("UPDATE app_notifications SET read = 1").run();
}

export function deleteNotification(id: string): void {
  db.prepare("DELETE FROM app_notifications WHERE id = ?").run(id);
}

export function clearAllNotifications(): void {
  db.prepare("DELETE FROM app_notifications").run();
}

export function getUnreadNotificationCount(): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM app_notifications WHERE read = 0")
    .get() as { count: number };
  return row.count;
}

// ─── Channel Connections ──────────────────────────────────────────────────────

interface ChannelConnectionRow {
  id: string;
  provider: string;
  account_id: string;
  account_name: string | null;
  account_email: string | null;
  account_avatar: string | null;
  scopes: string;
  created_at: string;
  updated_at: string;
}

function mapChannelConnectionRow(row: ChannelConnectionRow): ChannelConnection {
  return {
    id: row.id,
    provider: row.provider as ChannelId,
    accountId: row.account_id,
    accountName: row.account_name,
    accountEmail: row.account_email,
    accountAvatar: row.account_avatar,
    scopes: JSON.parse(row.scopes) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listChannelConnections(): ChannelConnection[] {
  const rows = db
    .prepare("SELECT * FROM oauth_connections ORDER BY provider, created_at ASC")
    .all() as ChannelConnectionRow[];
  return rows.map(mapChannelConnectionRow);
}

export function getChannelConnection(id: string): ChannelConnection | null {
  const row = db.prepare("SELECT * FROM oauth_connections WHERE id = ?").get(id) as
    | ChannelConnectionRow
    | undefined;
  return row ? mapChannelConnectionRow(row) : null;
}

export function upsertChannelConnection(data: {
  id: string;
  provider: ChannelId;
  accountId: string;
  accountName: string | null;
  accountEmail: string | null;
  accountAvatar: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}): ChannelConnection {
  db.prepare(
    `
    INSERT INTO oauth_connections
      (id, provider, account_id, account_name, account_email, account_avatar,
       access_token, refresh_token, token_expires_at, scopes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, account_id) DO UPDATE SET
      account_name = excluded.account_name,
      account_email = excluded.account_email,
      account_avatar = excluded.account_avatar,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expires_at = excluded.token_expires_at,
      scopes = excluded.scopes,
      updated_at = excluded.updated_at
  `
  ).run(
    data.id,
    data.provider,
    data.accountId,
    data.accountName,
    data.accountEmail,
    data.accountAvatar,
    data.accessToken,
    data.refreshToken,
    data.tokenExpiresAt,
    JSON.stringify(data.scopes),
    data.createdAt,
    data.updatedAt
  );
  const row = db
    .prepare("SELECT * FROM oauth_connections WHERE provider = ? AND account_id = ?")
    .get(data.provider, data.accountId) as ChannelConnectionRow;
  return mapChannelConnectionRow(row);
}

export function getChannelConnectionToken(
  id: string
): { accessToken: string; refreshToken: string | null } | null {
  const row = db
    .prepare("SELECT access_token, refresh_token FROM oauth_connections WHERE id = ?")
    .get(id) as { access_token: string; refresh_token: string | null } | undefined;
  if (!row) return null;
  return {
    accessToken: decryptApiKey(row.access_token),
    refreshToken: row.refresh_token ? decryptApiKey(row.refresh_token) : null,
  };
}

export function deleteChannelConnection(id: string): void {
  db.prepare("DELETE FROM oauth_connections WHERE id = ?").run(id);
}

export function deleteChannelConnectionWithRelatedData(id: string): void {
  db.prepare("DELETE FROM channel_sender_permissions WHERE connection_id = ?").run(id);
  db.prepare("DELETE FROM channel_pending_messages WHERE connection_id = ?").run(id);
  db.prepare("DELETE FROM channel_conversations WHERE channel_key LIKE ?").run(`${id}:%`);
  db.prepare(
    `DELETE FROM app_notifications
     WHERE type = 'channel_permission_request'
       AND json_extract(metadata, '$.connectionId') = ?`
  ).run(id);
  deleteChannelConnection(id);
}

/** Wipe all user data and reset settings to defaults. Used by the onboarding reset flow. */
export function resetAllData(): void {
  db.prepare("DELETE FROM oauth_connections").run();
  db.prepare("DELETE FROM channel_sender_permissions").run();
  db.prepare("DELETE FROM app_notifications").run();
  db.prepare("DELETE FROM scheduled_jobs").run();
  db.prepare("DELETE FROM conversations").run(); // messages cascade
  db.prepare("DELETE FROM user_models").run();
  db.prepare("DELETE FROM mem_memory_notes").run();
  db.prepare("DELETE FROM mem_episodes").run();
  db.prepare("DELETE FROM mem_blocks").run();
  db.prepare("DELETE FROM settings WHERE key = 'user_profile'").run();
  db.prepare("DELETE FROM settings WHERE key = 'app_settings'").run();
}
