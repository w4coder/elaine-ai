import { useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../lib/api";
import type {
  AppSettings,
  AskUserQuestion,
  ConversationDetail,
  ConversationSummary,
  ImageAttachment,
  MessageRecord,
  PermissionRequest,
  ProviderType,
  VisualizerWidget,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers (only used by streaming handlers)
// ---------------------------------------------------------------------------

function getMessageImages(message: MessageRecord): ImageAttachment[] {
  if (!Array.isArray(message.metadata?.images)) return [];
  return message.metadata.images.filter(
    (image): image is ImageAttachment =>
      typeof image === "object" &&
      image !== null &&
      typeof image.name === "string" &&
      typeof image.mimeType === "string" &&
      typeof image.dataUrl === "string"
  );
}

function makeOptimisticConversation(args: {
  conversationId: string;
  profile: { id: string; providerType: ProviderType };
  model: string;
  systemPrompt: string;
  workspacePath: string;
  content: string;
  images: ImageAttachment[];
  existing: ConversationDetail | null;
}): ConversationDetail {
  const now = new Date().toISOString();
  const userMessage: MessageRecord = {
    id: crypto.randomUUID(),
    conversationId: args.conversationId,
    role: "user",
    content: args.content,
    toolName: null,
    metadata: args.images.length ? { images: args.images } : null,
    createdAt: now,
  };

  if (args.existing) {
    return {
      ...args.existing,
      profileId: args.profile.id,
      providerType: args.profile.providerType,
      model: args.model,
      systemPrompt: args.systemPrompt,
      workspacePath: args.workspacePath || null,
      updatedAt: now,
      messages: [...args.existing.messages, userMessage],
    };
  }

  return {
    id: args.conversationId,
    title: "Generating title...",
    titleStatus: "pending",
    titleSource: "placeholder",
    profileId: args.profile.id,
    providerType: args.profile.providerType,
    model: args.model,
    systemPrompt: args.systemPrompt,
    workspacePath: args.workspacePath || null,
    createdAt: now,
    updatedAt: now,
    messages: [userMessage],
    pendingInteraction: null,
  };
}

function getEnabledProfiles(settings: AppSettings) {
  const enabled = settings.profiles.filter((p) => p.enabled);
  return enabled.length ? enabled : settings.profiles;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseChatStreamOptions {
  settings: AppSettings | null;
  profileId: string;
  model: string;
  systemPrompt: string;
  workspacePath: string;
  composer: string;
  composerImages: ImageAttachment[];
  activeConversation: ConversationDetail | null;
  activeConversationId: string | null;
  setComposer: (v: string) => void;
  setComposerImages: Dispatch<SetStateAction<ImageAttachment[]>>;
  setActiveConversationId: Dispatch<SetStateAction<string | null>>;
  setActiveConversation: Dispatch<SetStateAction<ConversationDetail | null>>;
  setConversations: Dispatch<SetStateAction<ConversationSummary[]>>;
  setTitleDraft: (v: string) => void;
  setError: (v: string | null) => void;
  setPendingQuestions: Dispatch<SetStateAction<AskUserQuestion[] | null>>;
  setPendingPermission: Dispatch<SetStateAction<PermissionRequest | null>>;
  conversationType?: "chat" | "schedule";
  setScheduleReady: Dispatch<
    SetStateAction<{ title: string; description: string; prompt: string } | null>
  >;
}

export interface UseChatStreamResult {
  isSending: boolean;
  incognitoMessages: MessageRecord[];
  setIncognitoMessages: Dispatch<SetStateAction<MessageRecord[]>>;
  handleSubmit: (contentOverride?: string) => Promise<void>;
  handleResend: (messageId: string, newContent: string) => Promise<void>;
  handleAskUserSubmit: (answers: Array<{ question: string; answer: string }>) => void;
  handleIncognitoSubmit: () => Promise<void>;
  handleIncognitoResend: (messageId: string, newContent: string) => Promise<void>;
}

export function useChatStream(opts: UseChatStreamOptions): UseChatStreamResult {
  const [isSending, setIsSending] = useState(false);
  const [incognitoMessages, setIncognitoMessages] = useState<MessageRecord[]>([]);

  async function handleSubmit(contentOverride?: string) {
    if (!opts.settings || isSending) return;

    const profiles = getEnabledProfiles(opts.settings);
    const selectedProfile = profiles.find((p) => p.id === opts.profileId) ?? profiles[0];
    if (!selectedProfile) {
      opts.setError("No provider profile is configured.");
      return;
    }
    if (!opts.model) {
      opts.setError("No model selected.");
      return;
    }

    const nextContent = (contentOverride ?? opts.composer).trim();
    const nextImages = [...opts.composerImages];
    if (!nextContent && nextImages.length === 0) return;
    if (
      nextImages.length > 0 &&
      !(selectedProfile.modelCapabilities?.[opts.model] ?? ["text"]).includes("image")
    ) {
      opts.setError(
        "This model does not support image input. Enable image capability in Settings → Models."
      );
      return;
    }

    const currentConversationId = opts.activeConversation?.id ?? `temp-${Date.now()}`;
    const optimisticConversation = makeOptimisticConversation({
      conversationId: currentConversationId,
      profile: selectedProfile,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      workspacePath: opts.workspacePath,
      content: nextContent,
      images: nextImages,
      existing: opts.activeConversation,
    });
    const nextSummary: ConversationSummary = {
      ...optimisticConversation,
      preview: nextContent || (nextImages.length ? "[Image]" : ""),
      messageCount: optimisticConversation.messages.length,
      lastMessageAt: optimisticConversation.updatedAt,
    };

    opts.setError(null);
    if (!contentOverride) {
      opts.setComposer("");
      opts.setComposerImages([]);
    }
    setIsSending(true);
    opts.setActiveConversationId(currentConversationId);
    opts.setActiveConversation(optimisticConversation);
    opts.setTitleDraft(optimisticConversation.title);
    opts.setConversations((current) => [
      nextSummary,
      ...current.filter((entry) => entry.id !== currentConversationId),
    ]);

    let realConversationId = currentConversationId;
    let receivedMeta = false;

    try {
      await api.streamChat(
        {
          conversationId: opts.activeConversation?.id,
          content: nextContent,
          images: nextImages,
          profileId: selectedProfile.id,
          model: opts.model,
          systemPrompt: opts.systemPrompt,
          workspacePath: opts.workspacePath || null,
          conversationType: !opts.activeConversation ? opts.conversationType : undefined,
        },
        {
          onMeta: (payload) => {
            receivedMeta = true;
            realConversationId = payload.conversationId;
            opts.setActiveConversationId(payload.conversationId);
            opts.setConversations((current) =>
              current.map((entry) =>
                entry.id === currentConversationId
                  ? { ...entry, id: payload.conversationId }
                  : entry
              )
            );
            opts.setActiveConversation((conversation) =>
              conversation && conversation.id === currentConversationId
                ? {
                    ...conversation,
                    id: payload.conversationId,
                    messages: (() => {
                      const messages = conversation.messages.map((message) => ({
                        ...message,
                        conversationId: payload.conversationId,
                      }));
                      const lastUserIndex = [...messages].map((m) => m.role).lastIndexOf("user");
                      if (lastUserIndex >= 0) {
                        messages[lastUserIndex] = {
                          ...messages[lastUserIndex],
                          id: payload.userMessageId,
                        };
                      }
                      if (payload.assistantMessageId) {
                        const lastMessage = messages[messages.length - 1];
                        if (lastMessage?.role === "assistant") {
                          messages[messages.length - 1] = {
                            ...lastMessage,
                            id: payload.assistantMessageId,
                            conversationId: payload.conversationId,
                          };
                        } else {
                          messages.push({
                            id: payload.assistantMessageId,
                            conversationId: payload.conversationId,
                            role: "assistant",
                            content: "",
                            toolName: null,
                            metadata: null,
                            createdAt: new Date().toISOString(),
                          });
                        }
                      }
                      return messages;
                    })(),
                  }
                : conversation
            );
          },
          onDelta: (payload) => {
            opts.setActiveConversation((conversation) => {
              if (!conversation) return conversation;
              const messages = [...conversation.messages];
              if (!messages.length || messages[messages.length - 1]?.role !== "assistant") {
                messages.push({
                  id: crypto.randomUUID(),
                  conversationId: conversation.id,
                  role: "assistant",
                  content: "",
                  toolName: null,
                  metadata: null,
                  createdAt: new Date().toISOString(),
                });
              }
              const last = messages[messages.length - 1];
              const metadata = { ...(last.metadata ?? {}) };
              const blocks = [
                ...(Array.isArray(metadata.blocks)
                  ? (metadata.blocks as import("../lib/types").MessageBlock[])
                  : []),
              ];
              if (typeof payload.reasoning === "string" && payload.reasoning) {
                const lastBlock = blocks[blocks.length - 1];
                if (lastBlock?.type === "reasoning") {
                  blocks[blocks.length - 1] = {
                    type: "reasoning",
                    content: lastBlock.content + payload.reasoning,
                  };
                } else {
                  blocks.push({ type: "reasoning", content: payload.reasoning });
                }
                metadata.blocks = blocks;
              }
              if (payload.content) {
                const lastBlock = blocks[blocks.length - 1];
                if (lastBlock?.type === "text") {
                  blocks[blocks.length - 1] = {
                    type: "text",
                    content: lastBlock.content + payload.content,
                  };
                } else {
                  blocks.push({ type: "text", content: payload.content });
                }
                metadata.blocks = blocks;
              }
              messages[messages.length - 1] = {
                ...last,
                content: `${last.content}${payload.content ?? ""}`,
                metadata: Object.keys(metadata).length ? metadata : null,
              };
              return { ...conversation, messages };
            });
          },
          onAskUser: ({ questions }) => {
            opts.setPendingQuestions(questions);
          },
          onPermissionRequired: (req) => {
            opts.setPendingPermission(req);
          },
          onWidgetLoading: ({ title }) => {
            opts.setActiveConversation((conversation) => {
              if (!conversation) return conversation;
              const messages = [...conversation.messages];
              if (!messages.length || messages[messages.length - 1]?.role !== "assistant") {
                messages.push({
                  id: crypto.randomUUID(),
                  conversationId: conversation.id,
                  role: "assistant",
                  content: "",
                  toolName: null,
                  metadata: null,
                  createdAt: new Date().toISOString(),
                });
              }
              const last = messages[messages.length - 1];
              const metadata = { ...(last.metadata ?? {}) };
              const blocks = [
                ...(Array.isArray(metadata.blocks)
                  ? (metadata.blocks as import("../lib/types").MessageBlock[])
                  : []),
              ];
              const existingIdx =
                blocks
                  .map((b, i) => (b.type === "widget_loading" ? i : -1))
                  .filter((i) => i >= 0)
                  .pop() ?? -1;
              if (existingIdx >= 0 && title) {
                blocks[existingIdx] = { type: "widget_loading", title };
              } else if (existingIdx < 0) {
                blocks.push({ type: "widget_loading", title });
              }
              metadata.blocks = blocks;
              messages[messages.length - 1] = { ...last, metadata };
              return { ...conversation, messages };
            });
          },
          onWidgetFailed: () => {
            opts.setActiveConversation((conversation) => {
              if (!conversation) return conversation;
              const messages = [...conversation.messages];
              if (!messages.length || messages[messages.length - 1]?.role !== "assistant")
                return conversation;
              const last = messages[messages.length - 1];
              const metadata = { ...(last.metadata ?? {}) };
              const blocks = [
                ...(Array.isArray(metadata.blocks)
                  ? (metadata.blocks as import("../lib/types").MessageBlock[])
                  : []),
              ];
              const loadingIdx =
                blocks
                  .map((b, i) => (b.type === "widget_loading" ? i : -1))
                  .filter((i) => i >= 0)
                  .pop() ?? -1;
              if (loadingIdx >= 0) blocks.splice(loadingIdx, 1);
              metadata.blocks = blocks;
              messages[messages.length - 1] = { ...last, metadata };
              return { ...conversation, messages };
            });
          },
          onWidget: (widget: VisualizerWidget) => {
            opts.setActiveConversation((conversation) => {
              if (!conversation) return conversation;
              const messages = [...conversation.messages];
              if (!messages.length || messages[messages.length - 1]?.role !== "assistant")
                return conversation;
              const last = messages[messages.length - 1];
              const metadata = { ...(last.metadata ?? {}) };
              const existingWidgets = Array.isArray(metadata.widgets)
                ? (metadata.widgets as VisualizerWidget[])
                : [];
              const widgetIndex = existingWidgets.length;
              metadata.widgets = [...existingWidgets, widget];
              const blocks = [
                ...(Array.isArray(metadata.blocks)
                  ? (metadata.blocks as import("../lib/types").MessageBlock[])
                  : []),
              ];
              const loadingIdx =
                blocks
                  .map((b, i) => (b.type === "widget_loading" ? i : -1))
                  .filter((i) => i >= 0)
                  .pop() ?? -1;
              if (loadingIdx >= 0) {
                blocks[loadingIdx] = { type: "widget", index: widgetIndex };
              } else {
                blocks.push({ type: "widget", index: widgetIndex });
              }
              metadata.blocks = blocks;
              messages[messages.length - 1] = { ...last, metadata };
              return { ...conversation, messages };
            });
          },
          onDone: ({ conversation }) => {
            opts.setActiveConversation(conversation);
            opts.setTitleDraft(conversation.title);
            opts.setActiveConversationId(conversation.id);
          },
          onError: ({ message }) => opts.setError(message),
          onScheduleReady: (payload) => {
            opts.setScheduleReady(payload);
          },
        }
      );

      if (realConversationId && !realConversationId.startsWith("temp-")) {
        const latest = await api.getConversation(realConversationId);
        opts.setActiveConversation(latest);
        opts.setTitleDraft(latest.title);
      }
    } catch (cause) {
      opts.setError(cause instanceof Error ? cause.message : "Failed to stream the reply.");
      if (!receivedMeta) {
        opts.setActiveConversationId(null);
        opts.setActiveConversation(null);
        opts.setConversations((current) =>
          current.filter((entry) => entry.id !== currentConversationId)
        );
      }
    } finally {
      setIsSending(false);
    }
  }

  async function handleResend(messageId: string, newContent: string) {
    if (!opts.settings || isSending || !opts.activeConversation) return;

    const profiles = getEnabledProfiles(opts.settings);
    const selectedProfile = profiles.find((p) => p.id === opts.profileId) ?? profiles[0];
    if (!selectedProfile) {
      opts.setError("No provider profile is configured.");
      return;
    }
    if (!opts.model) {
      opts.setError("No model selected.");
      return;
    }
    if (!newContent.trim()) return;

    const msgIndex = opts.activeConversation.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const originalMessage = opts.activeConversation.messages[msgIndex];
    const originalImages = getMessageImages(originalMessage);
    const now = new Date().toISOString();
    const optimisticUserMessage: MessageRecord = {
      id: crypto.randomUUID(),
      conversationId: opts.activeConversation.id,
      role: "user",
      content: newContent,
      toolName: null,
      metadata: originalImages.length ? { images: originalImages } : null,
      createdAt: now,
    };
    const optimisticConversation: ConversationDetail = {
      ...opts.activeConversation,
      messages: [...opts.activeConversation.messages.slice(0, msgIndex), optimisticUserMessage],
    };

    opts.setError(null);
    setIsSending(true);
    opts.setActiveConversation(optimisticConversation);

    const conversationId = opts.activeConversation.id;

    try {
      await api.streamChat(
        {
          conversationId,
          truncateFromMessageId: messageId,
          content: newContent,
          images: originalImages.length ? originalImages : undefined,
          profileId: selectedProfile.id,
          model: opts.model,
          systemPrompt: opts.systemPrompt,
          workspacePath: opts.workspacePath || null,
        },
        {
          onMeta: (payload) => {
            opts.setActiveConversation((conversation) => {
              if (!conversation) return conversation;
              const messages = conversation.messages.map((message) => ({
                ...message,
                conversationId: payload.conversationId,
              }));
              const lastUserIndex = [...messages].map((m) => m.role).lastIndexOf("user");
              if (lastUserIndex >= 0) {
                messages[lastUserIndex] = {
                  ...messages[lastUserIndex],
                  id: payload.userMessageId,
                };
              }
              if (payload.assistantMessageId) {
                const lastMessage = messages[messages.length - 1];
                if (lastMessage?.role === "assistant") {
                  messages[messages.length - 1] = {
                    ...lastMessage,
                    id: payload.assistantMessageId,
                    conversationId: payload.conversationId,
                  };
                } else {
                  messages.push({
                    id: payload.assistantMessageId,
                    conversationId: payload.conversationId,
                    role: "assistant",
                    content: "",
                    toolName: null,
                    metadata: null,
                    createdAt: new Date().toISOString(),
                  });
                }
              }
              return { ...conversation, messages };
            });
          },
          onDelta: (payload) => {
            opts.setActiveConversation((conversation) => {
              if (!conversation) return conversation;
              const messages = [...conversation.messages];
              if (!messages.length || messages[messages.length - 1]?.role !== "assistant") {
                messages.push({
                  id: crypto.randomUUID(),
                  conversationId: conversation.id,
                  role: "assistant",
                  content: "",
                  toolName: null,
                  metadata: null,
                  createdAt: new Date().toISOString(),
                });
              }
              const last = messages[messages.length - 1];
              const metadata = { ...(last.metadata ?? {}) };
              const nextReasoning =
                typeof payload.reasoning === "string"
                  ? `${String(metadata.reasoning ?? "")}${payload.reasoning}`
                  : metadata.reasoning;
              if (typeof nextReasoning === "string" && nextReasoning) {
                metadata.reasoning = nextReasoning;
              }
              messages[messages.length - 1] = {
                ...last,
                content: `${last.content}${payload.content ?? ""}`,
                metadata: Object.keys(metadata).length ? metadata : null,
              };
              return { ...conversation, messages };
            });
          },
          onAskUser: ({ questions }) => {
            opts.setPendingQuestions(questions);
          },
          onPermissionRequired: (req) => {
            opts.setPendingPermission(req);
          },
          onWidget: (widget: VisualizerWidget) => {
            opts.setActiveConversation((conversation) => {
              if (!conversation) return conversation;
              const messages = [...conversation.messages];
              if (!messages.length || messages[messages.length - 1]?.role !== "assistant")
                return conversation;
              const last = messages[messages.length - 1];
              const metadata = { ...(last.metadata ?? {}) };
              const existing = Array.isArray(metadata.widgets)
                ? (metadata.widgets as VisualizerWidget[])
                : [];
              metadata.widgets = [...existing, widget];
              messages[messages.length - 1] = { ...last, metadata };
              return { ...conversation, messages };
            });
          },
          onDone: ({ conversation }) => {
            opts.setActiveConversation(conversation);
            opts.setTitleDraft(conversation.title);
          },
          onError: ({ message }) => opts.setError(message),
        }
      );

      const latest = await api.getConversation(conversationId);
      opts.setActiveConversation(latest);
      opts.setTitleDraft(latest.title);
    } catch (cause) {
      opts.setError(cause instanceof Error ? cause.message : "Failed to stream the reply.");
    } finally {
      setIsSending(false);
    }
  }

  function handleAskUserSubmit(answers: Array<{ question: string; answer: string }>) {
    opts.setPendingQuestions(null);
    const formatted = answers.map((a, i) => `${i + 1}. ${a.question}\n   ${a.answer}`).join("\n\n");
    void handleSubmit(`Here are my answers:\n\n${formatted}`);
  }

  async function handleIncognitoSubmit() {
    if (!opts.settings || isSending) return;

    const profiles = getEnabledProfiles(opts.settings);
    const selectedProfile = profiles.find((p) => p.id === opts.profileId) ?? profiles[0];
    if (!selectedProfile) {
      opts.setError("No provider profile is configured.");
      return;
    }
    if (!opts.model) {
      opts.setError("No model selected.");
      return;
    }

    const nextContent = opts.composer.trim();
    const nextImages = [...opts.composerImages];
    if (!nextContent && nextImages.length === 0) return;
    if (
      nextImages.length > 0 &&
      !(selectedProfile.modelCapabilities?.[opts.model] ?? ["text"]).includes("image")
    ) {
      opts.setError(
        "This model does not support image input. Enable image capability in Settings → Models."
      );
      return;
    }

    const now = new Date().toISOString();
    const userMessage: MessageRecord = {
      id: crypto.randomUUID(),
      conversationId: "incognito",
      role: "user",
      content: nextContent,
      toolName: null,
      metadata: nextImages.length ? { images: nextImages } : null,
      createdAt: now,
    };

    const history = incognitoMessages
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
        images: getMessageImages(message),
      }))
      .filter((m) => m.role === "user" || m.role === "assistant");

    opts.setError(null);
    opts.setComposer("");
    opts.setComposerImages([]);
    setIsSending(true);
    setIncognitoMessages((current) => [...current, userMessage]);

    try {
      await api.streamEphemeralChat(
        {
          content: userMessage.content,
          images: nextImages,
          profileId: selectedProfile.id,
          model: opts.model,
          systemPrompt: opts.systemPrompt,
          messages: history,
        },
        {
          onDelta: (payload) => {
            setIncognitoMessages((current) => {
              const messages = [...current];
              if (!messages.length || messages[messages.length - 1]?.role !== "assistant") {
                messages.push({
                  id: crypto.randomUUID(),
                  conversationId: "incognito",
                  role: "assistant",
                  content: "",
                  toolName: null,
                  metadata: null,
                  createdAt: new Date().toISOString(),
                });
              }
              const last = messages[messages.length - 1];
              const metadata = { ...(last.metadata ?? {}) };
              const nextReasoning =
                typeof payload.reasoning === "string"
                  ? `${String(metadata.reasoning ?? "")}${payload.reasoning}`
                  : metadata.reasoning;
              if (typeof nextReasoning === "string" && nextReasoning) {
                metadata.reasoning = nextReasoning;
              }
              messages[messages.length - 1] = {
                ...last,
                content: `${last.content}${payload.content ?? ""}`,
                metadata: Object.keys(metadata).length ? metadata : null,
              };
              return messages;
            });
          },
          onError: ({ message }) => opts.setError(message),
        }
      );
    } catch (cause) {
      opts.setError(cause instanceof Error ? cause.message : "Failed to stream the reply.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleIncognitoResend(messageId: string, newContent: string) {
    if (!opts.settings || isSending) return;

    const profiles = getEnabledProfiles(opts.settings);
    const selectedProfile = profiles.find((p) => p.id === opts.profileId) ?? profiles[0];
    if (!selectedProfile || !opts.model || !newContent.trim()) return;

    const msgIndex = incognitoMessages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const truncatedMessages = incognitoMessages.slice(0, msgIndex);
    const originalImages = getMessageImages(incognitoMessages[msgIndex]);
    const now = new Date().toISOString();
    const userMessage: MessageRecord = {
      id: crypto.randomUUID(),
      conversationId: "incognito",
      role: "user",
      content: newContent,
      toolName: null,
      metadata: originalImages.length ? { images: originalImages } : null,
      createdAt: now,
    };

    const history = truncatedMessages
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
        images: getMessageImages(message),
      }))
      .filter((m) => m.role === "user" || m.role === "assistant");

    opts.setError(null);
    setIsSending(true);
    setIncognitoMessages([...truncatedMessages, userMessage]);

    try {
      await api.streamEphemeralChat(
        {
          content: newContent,
          images: originalImages.length ? originalImages : undefined,
          profileId: selectedProfile.id,
          model: opts.model,
          systemPrompt: opts.systemPrompt,
          messages: history,
        },
        {
          onDelta: (payload) => {
            setIncognitoMessages((current) => {
              const messages = [...current];
              if (!messages.length || messages[messages.length - 1]?.role !== "assistant") {
                messages.push({
                  id: crypto.randomUUID(),
                  conversationId: "incognito",
                  role: "assistant",
                  content: "",
                  toolName: null,
                  metadata: null,
                  createdAt: new Date().toISOString(),
                });
              }
              const last = messages[messages.length - 1];
              const metadata = { ...(last.metadata ?? {}) };
              const nextReasoning =
                typeof payload.reasoning === "string"
                  ? `${String(metadata.reasoning ?? "")}${payload.reasoning}`
                  : metadata.reasoning;
              if (typeof nextReasoning === "string" && nextReasoning) {
                metadata.reasoning = nextReasoning;
              }
              messages[messages.length - 1] = {
                ...last,
                content: `${last.content}${payload.content ?? ""}`,
                metadata: Object.keys(metadata).length ? metadata : null,
              };
              return messages;
            });
          },
          onError: ({ message }) => opts.setError(message),
        }
      );
    } catch (cause) {
      opts.setError(cause instanceof Error ? cause.message : "Failed to stream the reply.");
    } finally {
      setIsSending(false);
    }
  }

  return {
    isSending,
    incognitoMessages,
    setIncognitoMessages,
    handleSubmit,
    handleResend,
    handleAskUserSubmit,
    handleIncognitoSubmit,
    handleIncognitoResend,
  };
}
