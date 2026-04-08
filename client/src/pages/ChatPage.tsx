import React, {
  Fragment,
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  Brain,
  Calendar,
  ChevronUp,
  Ghost,
  Link2,
  MessageSquare,
  MessageSquarePlus,
  PanelLeft,
  Settings2,
  User,
} from "lucide-react";
import { AskUserWidget } from "../components/AskUserWidget";
import { PermissionWidget } from "../components/PermissionWidget";
import { ChatComposer } from "../components/ChatComposer";
import { MessageBubble } from "../components/MessageBubble";
import { NotificationCenter } from "../components/NotificationCenter";
import { ScheduleSetupWidget } from "../components/ScheduleSetupWidget";
import { SettingsDrawer } from "../components/SettingsDrawer";
import { Sidebar } from "../components/Sidebar";
import { useChatStream } from "../hooks/useChatStream";
import { useConversationList } from "../hooks/useConversationList";
import { useNotifications } from "../hooks/useNotifications";
import { useScheduleNotifications } from "../hooks/useScheduleNotifications";
import { usePendingInteractionNotifications } from "../hooks/usePendingInteractionNotifications";
import { api } from "../lib/api";
import { notificationStore } from "../lib/notification-store";
import type {
  AppSettings,
  AskUserQuestion,
  ConversationDetail,
  ImageAttachment,
  PermissionRequest,
  ProviderProfile,
  ScheduledJob,
  UserModel,
  UserProfile,
} from "../lib/types";
import { AppLogo } from "../components/AppLogo";

type GreetingFn = (name: string) => string;

const GREETINGS: Record<"morning" | "afternoon" | "evening", GreetingFn[]> = {
  morning: [
    (n) => (n ? `Good morning, ${n}.` : "Good morning."),
    (n) => (n ? `Morning, ${n}.` : "Morning."),
    (_) => "A new day, a clean slate.",
    (n) => (n ? `Rise and shine, ${n}.` : "Rise and shine."),
    (_) => "Ready when you are.",
  ],
  afternoon: [
    (n) => (n ? `Good afternoon, ${n}.` : "Good afternoon."),
    (n) => (n ? `Afternoon, ${n}.` : "Afternoon."),
    (_) => "What are we building today?",
    (n) => (n ? `Hey, ${n}.` : "Let's build."),
    (_) => "Pick up where you left off.",
  ],
  evening: [
    (n) => (n ? `Good evening, ${n}.` : "Good evening."),
    (n) => (n ? `Evening, ${n}.` : "Evening."),
    (_) => "Burning the midnight oil?",
    (n) => (n ? `Still at it, ${n}?` : "Still at it?"),
    (_) => "Let's make this count.",
  ],
};

const SCHEDULE_GREETINGS: Record<"morning" | "afternoon" | "evening", GreetingFn[]> = {
  morning: [
    (n) => (n ? `What's on your agenda today, ${n}?` : "What's on your agenda today?"),
    (n) => (n ? `Let's plan your day, ${n}.` : "Let's plan your day."),
    (_) => "A fresh day to schedule.",
    (n) => (n ? `Ready to organise your day, ${n}?` : "Ready to organise your day?"),
    (_) => "What needs scheduling today?",
  ],
  afternoon: [
    (n) => (n ? `What's left to plan, ${n}?` : "What's left to plan?"),
    (n) => (n ? `Afternoon, ${n}. Any tasks to schedule?` : "Any tasks to schedule?"),
    (_) => "Let's organise the rest of your day.",
    (n) => (n ? `Hey, ${n}. What needs setting up?` : "What needs setting up?"),
    (_) => "Schedule it before you forget.",
  ],
  evening: [
    (n) => (n ? `Planning ahead, ${n}?` : "Planning ahead?"),
    (n) => (n ? `Evening, ${n}. What's on tomorrow's list?` : "What's on tomorrow's list?"),
    (_) => "Let's set up tomorrow's tasks.",
    (n) => (n ? `Getting ahead, ${n}?` : "Getting ahead?"),
    (_) => "Plan now, execute tomorrow.",
  ],
};

function buildGreeting(profile: UserProfile | null, type: "chat" | "schedule" = "chat"): string {
  const name = profile?.name ?? "";

  if (profile?.birthday) {
    const [, bMonth, bDay] = profile.birthday.split("-").map(Number);
    const now = new Date();
    if (bMonth === now.getMonth() + 1 && bDay === now.getDate()) {
      return name ? `Happy birthday, ${name}!` : "Happy birthday!";
    }
  }

  const hour = new Date().getHours();
  const bucket = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const pool = type === "schedule" ? SCHEDULE_GREETINGS[bucket] : GREETINGS[bucket];
  const idx = new Date().getDay() % pool.length;
  return pool[idx](name);
}

function buildScheduleConfirmation(job: ScheduledJob): string {
  const intervalLabel: Record<number, string> = {
    [30 * 60 * 1000]: "every 30 minutes",
    [60 * 60 * 1000]: "every hour",
    [6 * 60 * 60 * 1000]: "every 6 hours",
    [12 * 60 * 60 * 1000]: "every 12 hours",
    [24 * 60 * 60 * 1000]: "daily",
    [7 * 24 * 60 * 60 * 1000]: "weekly",
  };
  const freq = intervalLabel[job.intervalMs] ?? `every ${job.intervalMs / 60000} min`;
  const nextRun = new Date(job.nextRunAt).toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const maxRunsNote = job.maxRuns
    ? `, stopping after ${job.maxRuns} run${job.maxRuns > 1 ? "s" : ""}`
    : "";
  return `✅ **${job.title}** scheduled — runs **${freq}**${maxRunsNote}.\n\nFirst run: ${nextRun}.`;
}

const starterPrompts = [
  {
    label: "Code",
    prompt:
      "Help me build a feature with a clean implementation plan, production-ready code, and verification steps.",
  },
  {
    label: "Review",
    prompt:
      "Review this implementation like a senior engineer. Focus on bugs, regressions, edge cases, and missing tests.",
  },
  {
    label: "Debug",
    prompt:
      "Help me debug a failing app. Ask for the fastest high-signal checks first, then propose the likely fix.",
  },
  {
    label: "Docs",
    prompt:
      "Write concise technical documentation for this project, including setup, architecture, and operating notes.",
  },
];

function getEnabledProfiles(settings: AppSettings | null): ProviderProfile[] {
  if (!settings) return [];
  const enabled = settings.profiles.filter((profile) => profile.enabled);
  return enabled.length ? enabled : settings.profiles;
}

function getSelectableModels(models: UserModel[], profiles: ProviderProfile[]): UserModel[] {
  const profileIds = new Set(profiles.map((profile) => profile.id));
  return models.filter((model) => profileIds.has(model.profileId));
}

function getDefaultSelectedModel(models: UserModel[], settings: AppSettings): UserModel | null {
  const activeProfile = settings.profiles.find((p) => p.id === settings.activeProfileId);
  if (activeProfile?.defaultModel) {
    const found = models.find(
      (m) => m.profileId === activeProfile.id && m.model === activeProfile.defaultModel
    );
    if (found) return found;
  }
  return models.find((m) => m.profileId === settings.activeProfileId) ?? models[0] ?? null;
}

export function ChatPage() {
  const { id: urlId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const initialUrlId = useRef(urlId);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ConversationDetail | null>(null);
  const [userModels, setUserModels] = useState<UserModel[]>([]);
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState("");
  const [composerImages, setComposerImages] = useState<ImageAttachment[]>([]);
  const [profileId, setProfileId] = useState("");
  const [model, setModel] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [pendingQuestions, setPendingQuestions] = useState<AskUserQuestion[] | null>(() => {
    if (!urlId) return null;
    try {
      const stored = localStorage.getItem(`elaine:pending_questions:${urlId}`);
      return stored ? (JSON.parse(stored) as AskUserQuestion[]) : null;
    } catch {
      return null;
    }
  });
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(() => {
    if (!urlId) return null;
    try {
      const stored = localStorage.getItem(`elaine:pending_permission:${urlId}`);
      return stored ? (JSON.parse(stored) as PermissionRequest) : null;
    } catch {
      return null;
    }
  });
  const [titleDraft, setTitleDraft] = useState("New conversation");
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scheduleReady, setScheduleReady] = useState<{
    title: string;
    description: string;
    prompt: string;
  } | null>(() => {
    if (!urlId) return null;
    try {
      const stored = localStorage.getItem(`elaine_schedule_ready_${urlId}`);
      return stored
        ? (JSON.parse(stored) as { title: string; description: string; prompt: string })
        : null;
    } catch {
      return null;
    }
  });
  const [activeScheduledJob, setActiveScheduledJob] = useState<ScheduledJob | null>(null);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [collapsedProfileMenuOpen, setCollapsedProfileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(() => notificationStore.unreadCount());

  useEffect(() => {
    return notificationStore.subscribe((items) =>
      setUnreadCount(items.filter((n) => !n.read).length)
    );
  }, []);
  const [incognito, setIncognito] = useState(false);
  const [pendingConversationType, setPendingConversationType] = useState<"chat" | "schedule">(
    "chat"
  );
  const pendingConversationTypeRef = useRef<"chat" | "schedule">("chat");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const deferredSearch = useDeferredValue(search);

  const { notify } = useNotifications();

  usePendingInteractionNotifications({
    pendingPermission,
    pendingQuestions,
    scheduleReady,
    conversationId: activeConversationId,
    conversationTitle: titleDraft,
    notify,
  });

  useScheduleNotifications({
    onStarted(conversationId) {
      // If no conversation is open, navigate to the new scheduled run.
      if (!activeConversationId) {
        setActiveConversationId(conversationId);
        navigate(`/c/${conversationId}`);
      }
    },
    onStep(conversationId, content, reasoning) {
      setActiveConversation((prev) => {
        if (!prev || prev.id !== conversationId) return prev;
        const messages = [...prev.messages];
        if (!messages.length || messages[messages.length - 1]?.role !== "assistant") {
          messages.push({
            id: crypto.randomUUID(),
            conversationId,
            role: "assistant",
            content: "",
            toolName: null,
            metadata: null,
            createdAt: new Date().toISOString(),
          });
        }
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = {
          ...last,
          content: `${last.content}${content ?? ""}`,
        };
        return { ...prev, messages };
      });
    },
    onCompleted(conversationId) {
      // Reload the conversation once the job finishes to get persisted state.
      if (activeConversationId === conversationId) {
        void api.getConversation(conversationId).then((conv) => {
          setActiveConversation(conv);
          setTitleDraft(conv.title);
        });
      }
    },
  });

  const { conversations, setConversations } = useConversationList({
    activeConversationId,
    setActiveConversation,
    setTitleDraft,
    setActiveConversationId,
  });

  const {
    isSending,
    incognitoMessages,
    setIncognitoMessages,
    handleSubmit,
    handleResend,
    handleAskUserSubmit,
    handleIncognitoSubmit,
    handleIncognitoResend,
  } = useChatStream({
    settings,
    profileId,
    model,
    systemPrompt,
    workspacePath,
    composer,
    composerImages,
    activeConversation,
    activeConversationId,
    setComposer,
    setComposerImages,
    setActiveConversationId,
    setActiveConversation,
    setConversations,
    setTitleDraft,
    setError,
    setPendingQuestions,
    setPendingPermission,
    conversationType: pendingConversationType,
    setScheduleReady,
  });

  // Load scheduled jobs when the user is on the schedule home screen
  useEffect(() => {
    if (pendingConversationType !== "schedule" || activeConversation || incognito) return;
    api
      .listScheduledJobs()
      .then(setScheduledJobs)
      .catch(() => undefined);
  }, [pendingConversationType, activeConversation, incognito]);

  // Sync pending state when navigating between conversations
  useEffect(() => {
    if (!urlId) {
      setPendingQuestions(null);
      setPendingPermission(null);
      return;
    }
    try {
      const q = localStorage.getItem(`elaine:pending_questions:${urlId}`);
      setPendingQuestions(q ? (JSON.parse(q) as AskUserQuestion[]) : null);
      const p = localStorage.getItem(`elaine:pending_permission:${urlId}`);
      setPendingPermission(p ? (JSON.parse(p) as PermissionRequest) : null);
    } catch {
      // ignore corrupt storage
    }
  }, [urlId]);

  // Persist pending questions keyed by conversation
  useEffect(() => {
    const id =
      activeConversationId && !activeConversationId.startsWith("temp-")
        ? activeConversationId
        : urlId;
    if (!id) return;
    const key = `elaine:pending_questions:${id}`;
    if (pendingQuestions) {
      localStorage.setItem(key, JSON.stringify(pendingQuestions));
    } else {
      localStorage.removeItem(key);
    }
  }, [pendingQuestions, activeConversationId, urlId]);

  // Persist pending permission keyed by conversation
  useEffect(() => {
    const id =
      pendingPermission?.conversationId ??
      (activeConversationId && !activeConversationId.startsWith("temp-")
        ? activeConversationId
        : urlId);
    if (!id) return;
    const key = `elaine:pending_permission:${id}`;
    if (pendingPermission) {
      localStorage.setItem(key, JSON.stringify(pendingPermission));
    } else {
      localStorage.removeItem(key);
    }
  }, [pendingPermission, activeConversationId, urlId]);

  // Persist scheduleReady per conversation so it survives a page refresh
  useEffect(() => {
    if (!activeConversationId || activeConversationId.startsWith("temp-")) return;
    if (scheduleReady) {
      localStorage.setItem(
        `elaine_schedule_ready_${activeConversationId}`,
        JSON.stringify(scheduleReady)
      );
    } else {
      localStorage.removeItem(`elaine_schedule_ready_${activeConversationId}`);
    }
  }, [scheduleReady, activeConversationId]);

  const filteredConversations = conversations.filter((conversation) => {
    const query = deferredSearch.trim().toLowerCase();
    return (
      !query ||
      [conversation.title, conversation.preview, conversation.model]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  });

  useEffect(() => {
    void (async () => {
      try {
        const [nextSettings, nextConversations, nextUserModels, nextUserProfile] =
          await Promise.all([
            api.getSettings(),
            api.listConversations(),
            api.listUserModels(),
            api.getUserProfile(),
          ]);
        setUserProfile(nextUserProfile);
        const profiles = getEnabledProfiles(nextSettings);
        const selectableModels = getSelectableModels(nextUserModels, profiles);
        const defaultSelectedModel = getDefaultSelectedModel(selectableModels, nextSettings);

        setSettings(nextSettings);
        setConversations(nextConversations);
        setUserModels(nextUserModels);
        if (defaultSelectedModel) {
          setProfileId(defaultSelectedModel.profileId);
          setModel(defaultSelectedModel.model);
        }
        setSystemPrompt(nextSettings.defaultSystemPrompt);
        if (initialUrlId.current) {
          setActiveConversationId(initialUrlId.current);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load the app.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load conversation data only when the active conversation ID changes.
  // Intentionally does NOT include model/profileId so a user-selected model
  // is never overwritten by a re-fetch of the same conversation.
  useEffect(() => {
    if (!activeConversationId || activeConversationId.startsWith("temp-")) return;

    let cancelled = false;
    void api
      .getConversation(activeConversationId)
      .then((conversation) => {
        if (cancelled) return;
        startTransition(() => {
          setActiveConversation(conversation);
          setProfileId(conversation.profileId);
          setModel(conversation.model);
          setWorkspacePath(conversation.workspacePath || "");
          setSystemPrompt(conversation.systemPrompt);
          setTitleDraft(conversation.title);

          // Restore pending interaction from DB (source of truth, survives device change)
          if (conversation.pendingInteraction?.type === "permission") {
            setPendingPermission(
              conversation.pendingInteraction.payload as unknown as PermissionRequest
            );
          } else if (conversation.pendingInteraction?.type === "ask_user") {
            setPendingQuestions(
              (conversation.pendingInteraction.payload as { questions: AskUserQuestion[] })
                .questions
            );
          } else {
            setPendingPermission(null);
            setPendingQuestions(null);
          }
        });
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load conversation.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

  // Reconcile model selection for new chats when settings or available models change.
  // model/profileId are intentionally omitted from deps — user selections should not
  // re-trigger reconciliation.
  useEffect(() => {
    if (!settings) return;
    if (activeConversationId && !activeConversationId.startsWith("temp-")) return;

    const profiles = getEnabledProfiles(settings);
    const selectableModels = getSelectableModels(userModels, profiles);
    const currentSelection = selectableModels.find(
      (entry) => entry.profileId === profileId && entry.model === model
    );
    const fallback = currentSelection ?? getDefaultSelectedModel(selectableModels, settings);

    if (fallback) {
      setProfileId(fallback.profileId);
      setModel(fallback.model);
    } else {
      setProfileId("");
      setModel("");
    }

    setSystemPrompt(settings.defaultSystemPrompt);
    setWorkspacePath("");
    setActiveConversation((conversation) =>
      activeConversationId?.startsWith("temp-") ? conversation : null
    );
    setTitleDraft("New conversation");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, settings, userModels]);

  useEffect(() => {
    const profiles = getEnabledProfiles(settings);
    const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null;
    const caps = selectedProfile?.modelCapabilities?.[model] ?? ["text"];
    if (!caps.includes("image") && composerImages.length > 0) {
      setComposerImages([]);
    }
  }, [composerImages.length, profileId, model, settings]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [activeConversation, incognitoMessages]);

  useEffect(() => {
    if (activeConversationId && !activeConversationId.startsWith("temp-")) {
      if (activeConversationId !== urlId) {
        navigate(`/c/${activeConversationId}`, { replace: true });
      }
    } else if (!activeConversationId && urlId) {
      navigate("/", { replace: true });
    }
  }, [activeConversationId, navigate, urlId]);

  async function handleSaveSettings(nextSettings: AppSettings) {
    setSettingsSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings(nextSettings);
      const nextUserModels = await api.listUserModels();
      const profiles = getEnabledProfiles(saved);
      const selectableModels = getSelectableModels(nextUserModels, profiles);
      const currentSelection = selectableModels.find(
        (entry) => entry.profileId === profileId && entry.model === model
      );
      const fallback = currentSelection ?? getDefaultSelectedModel(selectableModels, saved);

      setSettings(saved);
      setUserModels(nextUserModels);
      setSettingsOpen(false);
      if (fallback) {
        setProfileId(fallback.profileId);
        setModel(fallback.model);
      } else {
        setProfileId("");
        setModel("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save settings.");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleSaveProfile(
    updates: Pick<
      UserProfile,
      | "name"
      | "birthday"
      | "gender"
      | "responseLength"
      | "tone"
      | "toneLevel"
      | "focusAreas"
      | "proactiveness"
      | "extraContext"
    >
  ) {
    if (!userProfile) return;
    const updated = { ...userProfile, ...updates };
    await api.saveUserProfile(updated);
    setUserProfile(updated);
  }

  async function handleRenameConversation() {
    if (!activeConversation || titleDraft.trim() === activeConversation.title) return;

    try {
      const updated = await api.updateConversation(activeConversation.id, {
        title: titleDraft.trim(),
      });
      setActiveConversation(updated);
      setConversations((current) =>
        current.map((entry) =>
          entry.id === updated.id
            ? {
                ...entry,
                title: updated.title,
                titleSource: updated.titleSource,
                updatedAt: updated.updatedAt,
              }
            : entry
        )
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to rename conversation.");
    }
  }

  async function handleRenameConversationFromMenu(id: string, currentTitle: string) {
    const nextTitle = window.prompt("Rename conversation", currentTitle)?.trim();
    if (!nextTitle || nextTitle === currentTitle) {
      return;
    }

    try {
      const updated = await api.updateConversation(id, { title: nextTitle });
      setConversations((current) =>
        current.map((entry) =>
          entry.id === updated.id
            ? {
                ...entry,
                title: updated.title,
                titleSource: updated.titleSource,
                updatedAt: updated.updatedAt,
              }
            : entry
        )
      );

      if (activeConversation?.id === updated.id) {
        setActiveConversation(updated);
        setTitleDraft(updated.title);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to rename conversation.");
    }
  }

  async function handleDeleteConversation(id: string) {
    const isActive = id === activeConversationId;
    const conversation = conversations.find((entry) => entry.id === id);
    const confirmed = window.confirm(
      `Delete "${conversation?.title ?? "this conversation"}"? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      await api.deleteConversation(id);
      setConversations((current) => current.filter((entry) => entry.id !== id));
      if (isActive) {
        setActiveConversationId(null);
        setActiveConversation(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete conversation.");
    }
  }

  function toggleIncognito() {
    setIncognito((value) => {
      if (!value) {
        setActiveConversationId(null);
        setActiveConversation(null);
        setIncognitoMessages([]);
        setComposer("");
        setComposerImages([]);
      }
      return !value;
    });
  }

  if (!settings) {
    return <div className="loading-state">Loading Elaine...</div>;
  }

  const profiles = getEnabledProfiles(settings);
  const selectableModels = getSelectableModels(userModels, profiles);
  const hasIncognitoMessages = incognitoMessages.length > 0;
  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null;
  const activeModelCaps = selectedProfile?.modelCapabilities?.[model] ?? ["text"];
  const supportsImageUpload = activeModelCaps.includes("image");
  const activeConvType: "chat" | "schedule" | "scheduled_run" =
    activeConversation?.conversationType ?? pendingConversationType;

  return (
    <div className={`app-shell${sidebarOpen ? " app-shell--sidebar-open" : ""}`}>
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((open) => !open)}
        conversations={filteredConversations}
        activeId={incognito ? null : activeConversationId}
        userName={userProfile?.name ?? null}
        search={search}
        onSearchChange={setSearch}
        onNewConversation={() => {
          setPendingConversationType("chat");
          pendingConversationTypeRef.current = "chat";
          setIncognito(false);
          setActiveConversationId(null);
          setActiveConversation(null);
          setComposer("");
          setComposerImages([]);
          setTitleDraft("New conversation");
          setScheduleReady(null);
          setActiveScheduledJob(null);
        }}
        onNewSchedule={() => {
          setPendingConversationType("schedule");
          pendingConversationTypeRef.current = "schedule";
          setIncognito(false);
          setActiveConversationId(null);
          setActiveConversation(null);
          setComposer("");
          setComposerImages([]);
          setTitleDraft("New conversation");
          setScheduleReady(null);
          setActiveScheduledJob(null);
          navigate("/");
        }}
        onSelectConversation={(id) => {
          setIncognito(false);
          setComposerImages([]);
          setActiveScheduledJob(null);
          try {
            const stored = localStorage.getItem(`elaine_schedule_ready_${id}`);
            setScheduleReady(
              stored
                ? (JSON.parse(stored) as { title: string; description: string; prompt: string })
                : null
            );
          } catch {
            setScheduleReady(null);
          }
          startTransition(() => setActiveConversationId(id));
        }}
        onRenameConversation={(id, title) => void handleRenameConversationFromMenu(id, title)}
        onDeleteConversation={(id) => void handleDeleteConversation(id)}
      />

      <main
        className={`relative workspace${incognito ? " workspace--incognito" : ""} max-md:w-screen`}
      >
        <div className="workspace__topbar flex items-center justify-between gap-2 px-3 py-2">
          {!sidebarOpen && (
            <button
              className="z-10 icon-button"
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <PanelLeft size={20} />
            </button>
          )}
          {!urlId && !incognito && (
            <div className="flex flex-1 justify-center z-10">
              <div className="flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/10">
                <button
                  type="button"
                  className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm! font-medium transition-all ${pendingConversationType === "chat" ? "bg-accent text-white shadow-sm" : "text-[var(--text-soft)] hover:text-white"}`}
                  onClick={() => {
                    setPendingConversationType("chat");
                    pendingConversationTypeRef.current = "chat";
                  }}
                >
                  <MessageSquare size={14} />
                  Chat
                </button>
                <button
                  type="button"
                  className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm! font-medium transition-all ${pendingConversationType === "schedule" ? "bg-accent text-white shadow-sm" : "text-[var(--text-soft)] hover:text-white"}`}
                  onClick={() => {
                    setPendingConversationType("schedule");
                    pendingConversationTypeRef.current = "schedule";
                  }}
                >
                  <Calendar size={14} />
                  Schedule
                </button>
              </div>
            </div>
          )}
          {urlId && (
            <Fragment>
              <div className="flex flex-1 items-center gap-3 mx-8 z-10 h-13 max-md:mx-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveConversationId(null);
                    setActiveConversation(null);
                    setTitleDraft("New conversation");
                    setComposerImages([]);
                    navigate("/");
                  }}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: "rgba(255,255,255,0.45)" }}
                  onMouseEnter={(event) =>
                    (event.currentTarget.style.color = "rgba(255,255,255,0.85)")
                  }
                  onMouseLeave={(event) =>
                    (event.currentTarget.style.color = "rgba(255,255,255,0.45)")
                  }
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
                <input
                  className="workspace__title"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={() => void handleRenameConversation()}
                />
              </div>
              <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-[var(--text-soft)] z-10 select-none">
                {activeConvType === "schedule" ? (
                  <Calendar size={11} />
                ) : (
                  <MessageSquare size={11} />
                )}
                {activeConvType === "schedule" ? "Schedule" : "AI Chat"}
              </span>
              <button
                className="icon-button  w-8! h-8! flex items-center justify-center border-1 border-border rounded-full hover:text-white p-1 z-10"
                type="button"
                onClick={() => {
                  setActiveConversationId(null);
                  setActiveConversation(null);
                  setIncognito(false);
                }}
                aria-label="New chat"
                title="New chat"
              >
                <MessageSquarePlus size={13} />
              </button>
            </Fragment>
          )}
          <NotificationCenter />
          <button
            className={`z-10 icon-button incognito-toggle${incognito ? " incognito-toggle--active" : ""}`}
            type="button"
            onClick={toggleIncognito}
            aria-label={incognito ? "Exit incognito" : "Enter incognito"}
            title={incognito ? "Exit incognito" : "Start an incognito conversation"}
          >
            <Ghost size={25} />
          </button>
        </div>

        {incognito ? (
          hasIncognitoMessages ? (
            <div className="workspace__messages">
              <div className="workspace__incognito-badge">
                <Ghost size={14} />
                <span>Incognito</span>
              </div>
              <div className="message-list px-2">
                {incognitoMessages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={
                      isSending &&
                      index === incognitoMessages.length - 1 &&
                      message.role === "assistant"
                    }
                    onResend={
                      message.role === "user"
                        ? (content) => void handleIncognitoResend(message.id, content)
                        : undefined
                    }
                  />
                ))}
                {isSending && incognitoMessages[incognitoMessages.length - 1]?.role === "user" && (
                  <div className="msg-assistant-row">
                    <div className="msg-assistant flex items-center" style={{ minHeight: 36 }}>
                      <AppLogo size={22} animated />
                    </div>
                  </div>
                )}
                {error && !isSending && (
                  <div
                    className="msg-assistant-row"
                    style={{ color: "rgba(255,100,80,0.9)", fontSize: 13 }}
                  >
                    <div className="msg-assistant flex items-start gap-2">
                      <span style={{ marginTop: 1 }}>⚠</span>
                      <span>{error}</span>
                      <button
                        type="button"
                        onClick={() => setError(null)}
                        className="ml-auto opacity-50 hover:opacity-100 transition-opacity"
                        style={{ fontSize: 11 }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          ) : (
            <div className="workspace__empty">
              <div className="incognito-welcome">
                <Ghost size={48} className="incognito-welcome__icon" />
                <h2>You are incognito.</h2>
                <p>Conversations are not saved, added to history, or used to improve the model.</p>
              </div>
            </div>
          )
        ) : activeConversation ? (
          <div className="workspace__messages">
            <div className="message-list px-2">
              {activeConversation.messages.map((message, index) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isStreaming={
                    isSending &&
                    index === activeConversation.messages.length - 1 &&
                    message.role === "assistant"
                  }
                  onResend={
                    message.role === "user"
                      ? (content) => void handleResend(message.id, content)
                      : undefined
                  }
                  onSendPrompt={(text) => void handleSubmit(text)}
                />
              ))}
              {isSending &&
                activeConversation.messages[activeConversation.messages.length - 1]?.role ===
                  "user" && (
                  <div className="msg-assistant-row">
                    <div className="msg-assistant flex items-center" style={{ minHeight: 36 }}>
                      <AppLogo size={22} animated />
                    </div>
                  </div>
                )}
              {error && !isSending && (
                <div
                  className="msg-assistant-row"
                  style={{ color: "rgba(255,100,80,0.9)", fontSize: 13 }}
                >
                  <div className="msg-assistant flex items-start gap-2">
                    <span style={{ marginTop: 1 }}>⚠</span>
                    <span>{error}</span>
                    <button
                      type="button"
                      onClick={() => setError(null)}
                      className="ml-auto opacity-50 hover:opacity-100 transition-opacity"
                      style={{ fontSize: 11 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        ) : (
          <div className="workspace__empty pb-0! flex-col!">
            <div>
              <h2 className="workspace__hero-title flex items-center justify-center gap-2 max-md:flex-col">
                <AppLogo size={100} />
                {buildGreeting(userProfile, pendingConversationType)}
              </h2>
              {error && (
                <p
                  className="flex items-center gap-2 text-sm mt-3"
                  style={{ color: "rgba(255,100,80,0.9)" }}
                >
                  <span>⚠ {error}</span>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="opacity-50 hover:opacity-100 transition-opacity text-xs"
                  >
                    ✕
                  </button>
                </p>
              )}
            </div>
            {pendingConversationType === "schedule" && scheduledJobs.length > 0 && (
              <div className="mt-6 w-full max-w-md mx-auto">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
                    Your schedules
                  </span>
                  <button
                    type="button"
                    className="text-xs text-[var(--accent)] hover:opacity-80 transition-opacity"
                    onClick={() => navigate("/schedules")}
                  >
                    See all →
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {scheduledJobs.slice(0, 4).map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      className="flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl border border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/15 transition-all"
                      onClick={() => navigate("/schedules")}
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${job.enabled ? "bg-emerald-400" : "bg-white/20"}`}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-[var(--text)] truncate">
                          {job.title}
                        </span>
                        <span className="block text-xs text-[var(--text-muted)] mt-0.5">
                          {job.enabled
                            ? `Next run ${new Date(job.nextRunAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                            : "Paused"}
                        </span>
                      </span>
                      <Calendar size={13} className="text-[var(--text-muted)] shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="workspace__composer-area">
          {pendingPermission && !incognito && (
            <PermissionWidget
              request={pendingPermission}
              onAllowOnce={() => {
                void api
                  .grantPermission(
                    pendingPermission.conversationId,
                    pendingPermission.capability,
                    "once"
                  )
                  .then(() => {
                    setPendingPermission(null);
                    void handleSubmit("Permission granted for this call. Please continue.");
                  });
              }}
              onAllowThread={() => {
                void api
                  .grantPermission(
                    pendingPermission.conversationId,
                    pendingPermission.capability,
                    "thread"
                  )
                  .then(() => {
                    setPendingPermission(null);
                    void handleSubmit("Permission granted for this thread. Please continue.");
                  });
              }}
              onDeny={() => {
                setPendingPermission(null);
                void handleSubmit("Permission denied by user. Please stop and let me know.");
              }}
            />
          )}
          {pendingQuestions && !incognito && (
            <AskUserWidget
              questions={pendingQuestions}
              onSubmit={handleAskUserSubmit}
              onDismiss={() => setPendingQuestions(null)}
              onTimeout={() =>
                notify("Elaine needs your input", {
                  body: "The agent is waiting for you to answer clarifying questions.",
                  tag: `ask-user-${activeConversationId ?? "new"}`,
                  targetUrl: activeConversationId ? `/c/${activeConversationId}` : "/",
                })
              }
            />
          )}
          {scheduleReady && !activeScheduledJob && activeConversation && !incognito && (
            <ScheduleSetupWidget
              conversationId={activeConversation.id}
              profileId={profileId}
              model={model}
              title={scheduleReady.title}
              description={scheduleReady.description}
              prompt={scheduleReady.prompt}
              onCreated={(job) => {
                setActiveScheduledJob(job);
                setScheduleReady(null);
                void api
                  .addConversationMessage(
                    job.conversationId,
                    "assistant",
                    buildScheduleConfirmation(job)
                  )
                  .then(setActiveConversation)
                  .catch(() => undefined);
              }}
              onDismiss={() => setScheduleReady(null)}
            />
          )}
          <ChatComposer
            value={composer}
            disabled={isSending}
            isGenerating={isSending}
            supportsImageUpload={supportsImageUpload}
            profileId={profileId}
            model={model}
            models={selectableModels}
            profiles={profiles}
            images={composerImages}
            settings={settings}
            onChange={setComposer}
            onAddImages={(images) => setComposerImages((current) => [...current, ...images])}
            onRemoveImage={(index) =>
              setComposerImages((current) =>
                current.filter((_, imageIndex) => imageIndex !== index)
              )
            }
            onSubmit={() => void (incognito ? handleIncognitoSubmit() : handleSubmit())}
            onSelectModel={(entry) => {
              setProfileId(entry.profileId);
              setModel(entry.model);
              // Persist as user default
              if (settings) {
                const updated: AppSettings = {
                  ...settings,
                  activeProfileId: entry.profileId,
                  profiles: settings.profiles.map((p) =>
                    p.id === entry.profileId ? { ...p, defaultModel: entry.model } : p
                  ),
                };
                void api
                  .saveSettings(updated)
                  .then(setSettings)
                  .catch(() => undefined);
              }
              // Persist to the existing conversation so it survives a reload
              if (activeConversationId && !activeConversationId.startsWith("temp-")) {
                void api
                  .updateConversation(activeConversationId, {
                    profileId: entry.profileId,
                    model: entry.model,
                  })
                  .then((updated) => {
                    setActiveConversation(updated);
                  })
                  .catch(() => undefined);
              }
            }}
            onManageModels={() => navigate("/settings?tab=models")}
            onSaveSettings={(updates) => {
              if (!settings) return;
              void api.saveSettings({ ...settings, ...updates }).then(setSettings);
            }}
          />
          {!incognito && !activeConversation && (
            <div className="starter-chips">
              {starterPrompts.map((item) => (
                <button
                  key={item.label}
                  className="starter-chip"
                  type="button"
                  onClick={() => setComposer(item.prompt)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {!sidebarOpen && (
          <div className="workspace__collapsed-profile">
            {collapsedProfileMenuOpen && (
              <div className="sidebar__profile-menu workspace__collapsed-profile-menu">
                <button
                  className="sidebar__profile-menu-item"
                  type="button"
                  onClick={() => {
                    setCollapsedProfileMenuOpen(false);
                    navigate("/memory");
                  }}
                >
                  <Brain size={15} />
                  <span>Memory</span>
                </button>
                <button
                  className="sidebar__profile-menu-item"
                  type="button"
                  onClick={() => {
                    setCollapsedProfileMenuOpen(false);
                    navigate("/schedules");
                  }}
                >
                  <Calendar size={15} />
                  <span>Schedules</span>
                </button>
                <button
                  className="sidebar__profile-menu-item"
                  type="button"
                  onClick={() => {
                    setCollapsedProfileMenuOpen(false);
                    navigate("/notifications");
                  }}
                >
                  <Bell size={15} />
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <span
                      className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center"
                      style={{ background: "var(--accent)", color: "#fff" }}
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>
                <button
                  className="sidebar__profile-menu-item"
                  type="button"
                  onClick={() => {
                    setCollapsedProfileMenuOpen(false);
                    navigate("/channels");
                  }}
                >
                  <Link2 size={15} />
                  <span>Connections</span>
                </button>
                <button
                  className="sidebar__profile-menu-item"
                  type="button"
                  onClick={() => {
                    setCollapsedProfileMenuOpen(false);
                    navigate("/profile");
                  }}
                >
                  <User size={15} />
                  <span>My profile</span>
                </button>
                <button
                  className="sidebar__profile-menu-item"
                  type="button"
                  onClick={() => {
                    setCollapsedProfileMenuOpen(false);
                    navigate("/settings");
                  }}
                >
                  <Settings2 size={15} />
                  <span>Settings</span>
                </button>
              </div>
            )}
            <button
              className="workspace__collapsed-profile-btn max-md:hidden!"
              type="button"
              onClick={() => setCollapsedProfileMenuOpen((o) => !o)}
              aria-label="User menu"
            >
              <div className="sidebar__profile-avatar">
                {userProfile?.name ? userProfile.name[0].toUpperCase() : "E"}
              </div>
              <ChevronUp
                size={13}
                className={`sidebar__profile-chevron${collapsedProfileMenuOpen ? " sidebar__profile-chevron--open" : ""}`}
              />
            </button>
          </div>
        )}
      </main>

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        saving={settingsSaving}
        userProfile={userProfile}
        onClose={() => setSettingsOpen(false)}
        onSave={(nextSettings) => void handleSaveSettings(nextSettings)}
        onSaveProfile={handleSaveProfile}
      />
    </div>
  );
}
