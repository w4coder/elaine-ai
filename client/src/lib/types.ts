export type ProviderType = "openai" | "ollama" | "vllm";
export type ChatRole = "system" | "user" | "assistant" | "tool";
export type TitleStatus = "idle" | "pending" | "generating" | "ready" | "error";
export type TitleSource = "placeholder" | "generated" | "manual";

export interface ProviderProfile {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  titleModel?: string;
  pinnedModels?: string[];
  /** Per-model input capabilities, e.g. { "gpt-4o": ["text", "image"] } */
  modelCapabilities?: Record<string, string[]>;
  enabled: boolean;
}

export interface UserModelRecord {
  id: string;
  profileId: string;
  model: string;
  createdAt: string;
}

export interface UserModel extends UserModelRecord {
  profileName: string;
  providerType: ProviderType;
}

export type AsrProvider =
  | "vllm"
  | "vllm-small"
  | "localai"
  | "browser"
  | "groq"
  | "dashscope"
  | "openai";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  targetUrl: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

export type ChannelId = "telegram" | "whatsapp" | "discord" | "slack";

export type ChannelAuthType = "token" | "qr";

export interface ChannelDescriptor {
  id: ChannelId;
  label: string;
  description: string;
  authType: ChannelAuthType;
  color: string;
  docsUrl: string;
  tokenLabel?: string;
  tokenPlaceholder?: string;
  token2Label?: string;
  token2Placeholder?: string;
  needsClientCredentials: boolean;
}

export interface ChannelConnection {
  id: string;
  provider: ChannelId;
  accountId: string;
  accountName: string | null;
  accountEmail: string | null;
  accountAvatar: string | null;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

export type ChannelSenderStatus = "approved" | "blocked";

export interface ChannelSenderPermission {
  connectionId: string;
  channelId: ChannelId;
  senderId: string;
  senderName: string | null;
  status: ChannelSenderStatus;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelAppConfig {
  clientId: string;
  clientSecret: string; // MASKED when received from server
}

export interface SkillPermissionsSettings {
  chat: "auto" | "ask";
  task: "auto" | "ask";
  scheduled: "auto" | "ask";
}

export interface AppSettings {
  activeProfileId: string;
  defaultSystemPrompt: string;
  titleGenerationEnabled: boolean;
  profiles: ProviderProfile[];
  defaultMemoryProfileId?: string;
  defaultMemoryModel?: string;
  asrProvider?: AsrProvider;
  asrBaseUrl?: string;
  asrApiKey?: string;
  asrModel?: string;
  skillPermissions?: SkillPermissionsSettings;
  channels?: Partial<Record<ChannelId, ChannelAppConfig>>;
}

export interface PermissionRequest {
  skillName: string;
  capability: string;
  conversationId: string;
}

export interface SystemInfo {
  gpu: { name: string; vramMb: number } | null;
  ramMb: number;
  vllmRunning: boolean;
  localAiRunning: boolean;
  platform: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  titleStatus: TitleStatus;
  titleSource: TitleSource;
  profileId: string;
  providerType: ProviderType;
  model: string;
  systemPrompt: string;
  workspacePath: string | null;
  conversationType?: "chat" | "schedule" | "scheduled_run";
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  toolName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ImageAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface AskUserQuestion {
  question: string;
  suggestions?: string[];
}

export interface ConversationSummary extends ConversationRecord {
  preview: string;
  messageCount: number;
  lastMessageAt: string | null;
}

export interface PendingInteraction {
  type: "permission" | "ask_user";
  payload: Record<string, unknown>;
}

export interface ConversationDetail extends ConversationRecord {
  messages: MessageRecord[];
  pendingInteraction: PendingInteraction | null;
}

export interface ChatPayload {
  conversationId?: string;
  truncateFromMessageId?: string;
  content: string;
  images?: ImageAttachment[];
  profileId?: string;
  model?: string;
  systemPrompt?: string;
  workspacePath?: string | null;
  conversationType?: "chat" | "schedule";
}

export interface VisualizerWidget {
  type: "visualizer_widget";
  title: string;
  widget_code: string;
  loading_messages: string[];
}

/** Ordered content block stored in message metadata — preserves text/widget/reasoning interleaving. */
export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "widget"; index: number }
  | { type: "widget_loading"; title: string };

export interface StreamHandlers {
  onMeta?(payload: {
    conversationId: string;
    userMessageId: string;
    assistantMessageId?: string;
  }): void;
  onDelta?(payload: { content?: string; reasoning?: string }): void;
  onAskUser?(payload: { questions: AskUserQuestion[] }): void;
  onWidgetLoading?(payload: { title: string }): void;
  onWidgetFailed?(): void;
  onWidget?(payload: VisualizerWidget): void;
  onDone?(payload: { conversation: ConversationDetail }): void;
  onError?(payload: { message: string }): void;
  onScheduleReady?(payload: { title: string; description: string; prompt: string }): void;
  onPermissionRequired?(payload: PermissionRequest): void;
}

export interface EphemeralChatPayload {
  content: string;
  images?: ImageAttachment[];
  profileId?: string;
  model?: string;
  systemPrompt?: string;
  messages: Array<{ role: "user" | "assistant"; content: string; images?: ImageAttachment[] }>;
}

export interface EphemeralStreamHandlers {
  onDelta?(payload: { content?: string; reasoning?: string }): void;
  onDone?(payload: { content: string; reasoning?: string }): void;
  onError?(payload: { message: string }): void;
}

export interface UserProfile {
  version: 1;
  completedAt: string;
  name: string;
  birthday?: string;
  gender: string;
  responseLength: string;
  tone: string;
  toneLevel: number;
  focusAreas: string[];
  proactiveness: number;
  extraContext?: string;
}

export interface MemoryEpisode {
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
  processed_for_notes: number;
}

export type NoteKind =
  | "fact"
  | "preference"
  | "goal"
  | "constraint"
  | "skill"
  | "relationship"
  | "event";
export type NoteScope = "global" | "chat";
export type NoteStatus = "active" | "superseded" | "archived";

export interface MemoryNote {
  id: string;
  userId: string;
  chatId: string;
  kind: NoteKind;
  scope: NoteScope;
  summary: string;
  confidence: number;
  salience: number;
  status: NoteStatus;
  pinnedByUser: number;
  editedByUser: number;
  createdAt: string;
  updatedAt: string;
}

export type JobKind = "build_episodes" | "extract_notes" | "rebuild_blocks" | "decay_salience";
export type JobStatus = "pending" | "running" | "done" | "failed";

export interface MemoryJob {
  id: string;
  kind: JobKind;
  user_id: string;
  chat_id: string | null;
  status: JobStatus;
  attempts: number;
  error: string | null;
  created_at: string;
  run_after: string;
}

export type BlockKind = "projects" | "preferences" | "constraints" | "active_tasks";

export interface MemoryBlock {
  id: string;
  userId: string;
  chatId: string;
  kind: BlockKind;
  content: string;
  updatedAt: string;
}

export interface ScheduledJob {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  userPrompt: string;
  profileId: string;
  model: string;
  intervalMs: number;
  enabled: boolean;
  maxRuns: number | null;
  runCount: number;
  lastRunAt: string | null;
  lastRunConversationId: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

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
  valid: boolean;
}

export const INTERVAL_PRESETS = [
  { label: "30 min", value: "30m" },
  { label: "1 hour", value: "1h" },
  { label: "6 hours", value: "6h" },
  { label: "12 hours", value: "12h" },
  { label: "Daily", value: "1d" },
  { label: "Weekly", value: "1w" },
] as const;
