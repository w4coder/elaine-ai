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
  classifierModel?: string;
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
  // ASR (automatic speech recognition) settings
  asrProvider?: string;
  asrBaseUrl?: string;
  asrApiKey?: string;
  asrModel?: string;
  /** Per-mode permission behaviour for non-safe skills. */
  skillPermissions?: SkillPermissionsSettings;
  /** OAuth app credentials per provider (clientId + encrypted clientSecret). */
  channels?: Partial<Record<ChannelId, ChannelAppConfig>>;
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

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AskUserQuestion {
  question: string;
  suggestions?: string[];
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  /** Present on assistant messages that requested tool calls. */
  toolCalls?: ToolCall[];
  /** Present on tool-result messages (OpenAI requires this to match the call id). */
  toolCallId?: string;
}

export interface VisualizerWidget {
  type: "visualizer_widget";
  title: string;
  widget_code: string;
  loading_messages: string[];
}

export interface ProviderStreamChunk {
  content?: string;
  reasoning?: string;
  /** Emitted as a single terminal chunk when the model requested tool calls. */
  toolCalls?: ToolCall[];
  /** Emitted when ask_user is called — triggers the question widget in the UI. */
  questions?: AskUserQuestion[];
  /** Emitted when visualize__show_widget is called — renders an inline iframe widget. */
  widget?: VisualizerWidget;
  /** Emitted just before a widget skill executes so the client can show a skeleton. */
  widgetLoading?: true;
  /** Title passed alongside widgetLoading. */
  widgetTitle?: string;
  /** Emitted when a widget skill fails so the client can remove the skeleton. */
  widgetFailed?: true;
  /** Emitted when schedule_setup is called — triggers the schedule setup widget in the UI. */
  scheduleReady?: { title: string; description: string; prompt: string };
  /** Emitted when a skill requires a permission grant before it can execute. */
  permissionRequired?: { skillName: string; capability: string; conversationId: string };
}

export interface ChatStreamEventMap {
  meta: {
    conversationId: string;
    userMessageId: string;
    assistantMessageId?: string;
  };
  delta: {
    content?: string;
    reasoning?: string;
  };
  ask_user: {
    questions: AskUserQuestion[];
  };
  widget_loading: { title: string };
  widget_failed: Record<string, never>;
  widget: VisualizerWidget;
  done: {
    conversation: ConversationDetail;
  };
  error: {
    message: string;
  };
  schedule_ready: {
    title: string;
    description: string;
    prompt: string;
  };
  permission_required: {
    skillName: string;
    capability: string;
    conversationId: string;
  };
}

export interface EphemeralStreamEventMap {
  delta: { content?: string; reasoning?: string };
  done: { content: string; reasoning?: string };
  error: { message: string };
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
export type ChannelRoutingMode = "direct" | "mentions" | "all";

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
  /** Label for a second required token (e.g. Slack app-level token) */
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
  routingMode: ChannelRoutingMode;
  replyInThread: boolean;
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

export interface PendingChannelMessage {
  id: string;
  connectionId: string;
  channelId: ChannelId;
  senderId: string;
  senderName: string | null;
  conversationKey: string;
  replyTargetId: string;
  replyThreadId: string | null;
  replyMessageId: string | null;
  text: string;
  createdAt: string;
}

export interface ChannelReplyOptions {
  threadId?: string | null;
  replyMessageId?: string | null;
}

export type ChannelCapabilityGrantType = "once" | "chat" | "deny";

export interface ChannelCapabilityGrant {
  connectionId: string;
  conversationKey: string;
  capability: string;
  decision: ChannelCapabilityGrantType;
  createdAt: string;
  updatedAt: string;
}

export interface PendingChannelCapabilityRequest {
  id: string;
  connectionId: string;
  channelId: ChannelId;
  scopeKey: string;
  conversationKey: string;
  senderId: string;
  senderName: string | null;
  replyTargetId: string;
  replyThreadId: string | null;
  replyMessageId: string | null;
  capability: string;
  skillName: string;
  text: string;
  createdAt: string;
}

export interface ChannelAppConfig {
  clientId: string;
  clientSecret: string; // encrypted in DB, MASKED when sent to client
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
