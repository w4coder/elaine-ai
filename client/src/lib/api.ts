import type {
  AppNotification,
  AppSettings,
  AsrProvider,
  AuditLogEntry,
  ChannelConnection,
  ChannelDescriptor,
  ChannelId,
  ChannelSenderPermission,
  ChannelSenderStatus,
  ChatPayload,
  ConversationDetail,
  ConversationSummary,
  EphemeralChatPayload,
  EphemeralStreamHandlers,
  MemoryBlock,
  MemoryEpisode,
  MemoryJob,
  MemoryNote,
  ScheduledJob,
  StreamHandlers,
  SystemInfo,
  UserModel,
  UserProfile,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    headers,
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  async getUserProfile(): Promise<UserProfile | null> {
    const res = await fetch("/api/user-profile");
    if (res.status === 204) return null;
    if (!res.ok) return null;
    return res.json() as Promise<UserProfile>;
  },
  saveUserProfile(profile: UserProfile) {
    return request<UserProfile>("/api/user-profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    });
  },
  getSettings() {
    return request<AppSettings>("/api/settings");
  },
  saveSettings(settings: AppSettings) {
    return request<AppSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  },
  listConversations() {
    return request<ConversationSummary[]>("/api/conversations");
  },
  getConversation(id: string) {
    return request<ConversationDetail>(`/api/conversations/${id}`);
  },
  updateConversation(id: string, body: Record<string, unknown>) {
    return request<ConversationDetail>(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  addConversationMessage(id: string, role: "assistant" | "system", content: string) {
    return request<ConversationDetail>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    });
  },
  subscribeConversationEvents(handlers: {
    onUpsert?(payload: { type: "upsert"; conversation: ConversationSummary }): void;
    onDelete?(payload: { type: "delete"; conversationId: string }): void;
    onError?(): void;
  }) {
    const source = new EventSource("/api/events/conversations");
    source.addEventListener("upsert", (event) => {
      handlers.onUpsert?.(
        JSON.parse((event as MessageEvent).data) as {
          type: "upsert";
          conversation: ConversationSummary;
        }
      );
    });
    source.addEventListener("delete", (event) => {
      handlers.onDelete?.(
        JSON.parse((event as MessageEvent).data) as { type: "delete"; conversationId: string }
      );
    });
    source.onerror = () => {
      handlers.onError?.();
    };

    return () => {
      source.close();
    };
  },
  deleteConversation(id: string) {
    return request<void>(`/api/conversations/${id}`, {
      method: "DELETE",
    });
  },
  listUserModels() {
    return request<UserModel[]>("/api/models");
  },
  createUserModel(payload: { profileId: string; model: string }) {
    return request<UserModel>("/api/models", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  deleteUserModel(id: string) {
    return request<void>(`/api/models/${id}`, {
      method: "DELETE",
    });
  },
  validateUserModel(payload: { profileId: string; model: string }) {
    return request<{ supported: boolean; availableModels?: string[]; error?: string }>(
      "/api/models/validate",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },
  listModels(profileId: string) {
    const params = new URLSearchParams({ profileId });
    return request<{ models: string[] }>(`/api/providers/models?${params.toString()}`);
  },
  checkModel(profileId: string, model: string) {
    const params = new URLSearchParams({ profileId, model });
    return request<{ supported: boolean; error?: string }>(
      `/api/providers/check-model?${params.toString()}`
    );
  },
  validateProvider(payload: {
    providerType: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
  }) {
    return request<{ supported: boolean; availableModels?: string[]; error?: string }>(
      "/api/providers/validate",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },
  async streamChat(payload: ChatPayload, handlers: StreamHandlers) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        (await response.text()) || `Chat request failed with status ${response.status}`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleBlock = (block: string) => {
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (!eventLine || !dataLine) {
        return;
      }

      const event = eventLine.slice(6).trim();
      const payload = JSON.parse(dataLine.slice(5).trim()) as unknown;

      if (event === "meta") {
        handlers.onMeta?.(
          payload as { conversationId: string; userMessageId: string; assistantMessageId?: string }
        );
      }
      if (event === "delta") {
        handlers.onDelta?.(payload as { content?: string; reasoning?: string });
      }
      if (event === "done") {
        handlers.onDone?.(payload as { conversation: ConversationDetail });
      }
      if (event === "error") {
        handlers.onError?.(payload as { message: string });
      }
      if (event === "ask_user") {
        handlers.onAskUser?.(payload as { questions: import("./types").AskUserQuestion[] });
      }
      if (event === "widget_loading") {
        handlers.onWidgetLoading?.(payload as { title: string });
      }
      if (event === "widget_failed") {
        handlers.onWidgetFailed?.();
      }
      if (event === "widget") {
        handlers.onWidget?.(payload as import("./types").VisualizerWidget);
      }
      if (event === "schedule_ready") {
        handlers.onScheduleReady?.(
          payload as { title: string; description: string; prompt: string }
        );
      }
      if (event === "permission_required") {
        handlers.onPermissionRequired?.(payload as import("./types").PermissionRequest);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      blocks.forEach(handleBlock);
    }

    if (buffer.trim()) {
      handleBlock(buffer);
    }
  },

  listMemoryNotes() {
    return request<MemoryNote[]>("/api/memory/notes");
  },
  listMemoryBlocks() {
    return request<MemoryBlock[]>("/api/memory/blocks");
  },
  listMemoryJobs() {
    return request<MemoryJob[]>("/api/memory/jobs");
  },
  listMemoryEpisodes() {
    return request<MemoryEpisode[]>("/api/memory/episodes");
  },
  patchMemoryNote(id: string, patch: { pinnedByUser?: number; summary?: string; status?: string }) {
    return request<MemoryNote>(`/api/memory/notes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  deleteMemoryNote(id: string) {
    return request<void>(`/api/memory/notes/${id}`, { method: "DELETE" });
  },
  readFile(path: string) {
    const params = new URLSearchParams({ path });
    return request<{ content: string; path: string }>(`/api/fs/read?${params.toString()}`);
  },
  getSystemInfo() {
    return request<SystemInfo>("/api/system-info");
  },
  validateAsrConfig(config: {
    asrProvider: AsrProvider;
    asrBaseUrl?: string;
    asrApiKey?: string;
    asrModel?: string;
  }) {
    return request<{ ok: boolean; error?: string }>("/api/asr/validate", {
      method: "POST",
      body: JSON.stringify(config),
    });
  },
  async transcribeAudio(blob: Blob) {
    const form = new FormData();
    const ext = blob.type.split("/")[1] ?? "wav";
    form.append("file", blob, `audio.${ext}`);
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ text: string }>;
  },
  listScheduledJobs() {
    return request<ScheduledJob[]>("/api/scheduled-jobs");
  },
  getScheduledJob(id: string) {
    return request<ScheduledJob>(`/api/scheduled-jobs/${id}`);
  },
  createScheduledJob(payload: {
    conversationId: string;
    title: string;
    description: string;
    userPrompt: string;
    profileId: string;
    model: string;
    intervalValue: string;
    runAtTime?: string;
    runAtDay?: number;
    enabled: boolean;
    maxRuns: number | null;
  }) {
    return request<ScheduledJob>("/api/scheduled-jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateScheduledJob(
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      userPrompt: string;
      intervalValue: string;
      runAtTime: string;
      runAtDay: number;
      enabled: boolean;
      maxRuns: number | null;
    }>
  ) {
    return request<ScheduledJob>(`/api/scheduled-jobs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  deleteScheduledJob(id: string) {
    return request<void>(`/api/scheduled-jobs/${id}`, { method: "DELETE" });
  },
  subscribeNotificationEvents(handlers: {
    onScheduleStarted?(payload: { jobId: string; jobTitle: string; conversationId: string }): void;
    onScheduleStep?(payload: {
      conversationId: string;
      content?: string;
      reasoning?: string;
    }): void;
    onScheduleCompleted?(payload: {
      jobId: string;
      jobTitle: string;
      conversationId: string;
      success: boolean;
    }): void;
    onNotificationCreated?(payload: { notification: AppNotification }): void;
    onError?(): void;
  }) {
    const source = new EventSource("/api/events/notifications");
    source.addEventListener("schedule_started", (event) => {
      handlers.onScheduleStarted?.(
        JSON.parse((event as MessageEvent).data) as {
          jobId: string;
          jobTitle: string;
          conversationId: string;
        }
      );
    });
    source.addEventListener("schedule_step", (event) => {
      handlers.onScheduleStep?.(
        JSON.parse((event as MessageEvent).data) as {
          conversationId: string;
          content?: string;
          reasoning?: string;
        }
      );
    });
    source.addEventListener("schedule_completed", (event) => {
      handlers.onScheduleCompleted?.(
        JSON.parse((event as MessageEvent).data) as {
          jobId: string;
          jobTitle: string;
          conversationId: string;
          success: boolean;
        }
      );
    });
    source.addEventListener("notification_created", (event) => {
      handlers.onNotificationCreated?.(
        JSON.parse((event as MessageEvent).data) as { notification: AppNotification }
      );
    });
    source.onerror = () => {
      handlers.onError?.();
    };
    return () => {
      source.close();
    };
  },
  listNotifications(opts?: { limit?: number; unreadOnly?: boolean }) {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.unreadOnly) params.set("unread", "true");
    const qs = params.toString();
    return request<AppNotification[]>(`/api/notifications${qs ? `?${qs}` : ""}`);
  },
  getNotification(id: string) {
    return request<AppNotification>(`/api/notifications/${id}`);
  },
  getUnreadNotificationCount() {
    return request<{ count: number }>("/api/notifications/unread-count");
  },
  markNotificationRead(id: string, read = true) {
    return request<AppNotification>(`/api/notifications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ read }),
    });
  },
  markAllNotificationsRead() {
    return request<{ ok: boolean }>("/api/notifications/read-all", { method: "POST" });
  },
  deleteNotification(id: string) {
    return request<void>(`/api/notifications/${id}`, { method: "DELETE" });
  },
  clearAllNotifications() {
    return request<void>("/api/notifications", { method: "DELETE" });
  },
  grantPermission(
    conversationId: string,
    capability: string,
    type: "once" | "thread" | "deny" = "thread"
  ) {
    return request<{ ok: boolean }>(`/api/conversations/${conversationId}/grant-permission`, {
      method: "POST",
      body: JSON.stringify({ capability, type }),
    });
  },
  listAuditLog(opts?: {
    conversationId?: string;
    skillName?: string;
    limit?: number;
    offset?: number;
  }) {
    const params = new URLSearchParams();
    if (opts?.conversationId) params.set("conversationId", opts.conversationId);
    if (opts?.skillName) params.set("skillName", opts.skillName);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return request<AuditLogEntry[]>(`/api/audit-log${qs ? `?${qs}` : ""}`);
  },
  resetAllData() {
    return request<void>("/api/reset", { method: "POST" });
  },
  listChannels() {
    return request<ChannelDescriptor[]>("/api/channels/registry");
  },
  listChannelAccounts() {
    return request<ChannelConnection[]>("/api/channels/accounts");
  },
  listChannelSenders(connectionId?: string) {
    const qs = connectionId ? `?${new URLSearchParams({ connectionId }).toString()}` : "";
    return request<ChannelSenderPermission[]>(`/api/channels/senders${qs}`);
  },
  setChannelSenderPermission(payload: {
    connectionId: string;
    channelId: ChannelId;
    senderId: string;
    senderName?: string | null;
    status: ChannelSenderStatus;
  }) {
    return request<ChannelSenderPermission>("/api/channels/senders", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteChannelSenderPermission(connectionId: string, senderId: string) {
    const qs = new URLSearchParams({ connectionId, senderId });
    return request<void>(`/api/channels/senders?${qs.toString()}`, { method: "DELETE" });
  },
  connectChannel(channelId: ChannelId) {
    return request<{ authUrl: string }>(`/api/channels/${channelId}/connect`, { method: "POST" });
  },
  connectWithToken(channelId: ChannelId, token: string, token2?: string) {
    return request<ChannelConnection>(`/api/channels/${channelId}/token`, {
      method: "POST",
      body: JSON.stringify({ token, token2 }),
    });
  },

  openWhatsAppQrStream(handlers: {
    onQr(dataUrl: string): void;
    onConnected(data: { connectionId: string; accountName: string }): void;
    onError(message: string): void;
  }): () => void {
    const source = new EventSource("/api/channels/whatsapp/qr");
    source.addEventListener("qr", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { dataUrl: string };
      handlers.onQr(d.dataUrl);
    });
    source.addEventListener("connected", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as {
        connectionId: string;
        accountName: string;
      };
      handlers.onConnected(d);
      source.close();
    });
    source.addEventListener("error", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { message: string };
      handlers.onError(d.message);
      source.close();
    });
    return () => source.close();
  },
  disconnectChannel(id: string) {
    return request<void>(`/api/channels/accounts/${id}`, { method: "DELETE" });
  },
  async streamEphemeralChat(payload: EphemeralChatPayload, handlers: EphemeralStreamHandlers) {
    const response = await fetch("/api/chat/ephemeral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        (await response.text()) || `Chat request failed with status ${response.status}`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleBlock = (block: string) => {
      const lines = block.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event:"));
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (!eventLine || !dataLine) return;

      const event = eventLine.slice(6).trim();
      const data = JSON.parse(dataLine.slice(5).trim()) as unknown;

      if (event === "delta") handlers.onDelta?.(data as { content?: string; reasoning?: string });
      if (event === "done") handlers.onDone?.(data as { content: string; reasoning?: string });
      if (event === "error") handlers.onError?.(data as { message: string });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      blocks.forEach(handleBlock);
    }

    if (buffer.trim()) handleBlock(buffer);
  },
};
