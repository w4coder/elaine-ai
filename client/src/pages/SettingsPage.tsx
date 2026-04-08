import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Hash,
  Link2,
  MessageCircle,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ASRSetupModal } from "../components/ASRSetupModal";
import { api } from "../lib/api";
import type {
  AppSettings,
  ChannelConnection,
  ChannelDescriptor,
  ChannelId,
  ProviderProfile,
  ProviderType,
  UserModel,
} from "../lib/types";

// ─── Shared with ModelsPage ───────────────────────────────────────────────────

const MASKED = "__masked__";

const PROVIDER_DEFAULTS: Record<
  ProviderType,
  { label: string; url: string; placeholder: string; needsKey: boolean }
> = {
  ollama: {
    label: "Ollama",
    url: "http://127.0.0.1:11434",
    placeholder: "llama3.2",
    needsKey: false,
  },
  openai: {
    label: "OpenAI Compatible",
    url: "https://api.openai.com/v1",
    placeholder: "gpt-4o",
    needsKey: true,
  },
  vllm: {
    label: "vLLM",
    url: "http://127.0.0.1:8000",
    placeholder: "meta-llama/Llama-3-8b-instruct",
    needsKey: false,
  },
};

const ASR_PROVIDER_LABELS: Record<string, string> = {
  vllm: "Qwen3-ASR 1.7B (local)",
  "vllm-small": "Qwen3-ASR 0.6B (local)",
  localai: "Whisper · LocalAI (local)",
  browser: "Browser dictation",
  groq: "Groq (cloud)",
  dashscope: "Dashscope (cloud)",
  openai: "OpenAI Whisper (cloud)",
};

const inputClass = "w-full px-3 py-2.5 text-sm rounded-xl outline-none transition-colors";
const inputStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.85)",
};

interface FormState {
  providerType: ProviderType;
  name: string;
  modelId: string;
  url: string;
  apiKey: string;
  capabilities: string[];
}

const blankForm = (type: ProviderType = "ollama"): FormState => ({
  providerType: type,
  name: PROVIDER_DEFAULTS[type].label,
  modelId: "",
  url: PROVIDER_DEFAULTS[type].url,
  apiKey: "",
  capabilities: ["text"],
});

function toMaskedSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => ({
      ...profile,
      apiKey: profile.apiKey ? MASKED : profile.apiKey,
    })),
    channels: settings.channels
      ? Object.fromEntries(
          Object.entries(settings.channels).map(([id, cfg]) => [
            id,
            { ...cfg, clientSecret: cfg.clientSecret ? MASKED : cfg.clientSecret },
          ])
        )
      : undefined,
  };
}

// ─── Channel icons ────────────────────────────────────────────────────────────

const CH_ICON_SIZE = 18;
const CHANNEL_ICONS: Record<ChannelId, React.ReactNode> = {
  telegram: <Send size={CH_ICON_SIZE} />,
  whatsapp: <MessageSquare size={CH_ICON_SIZE} />,
  discord: <Hash size={CH_ICON_SIZE} />,
  slack: <MessageCircle size={CH_ICON_SIZE} />,
};

// ─── Channel connect modal ────────────────────────────────────────────────────

interface ChannelModalProps {
  channel: ChannelDescriptor;
  onClose(): void;
  onConnected(conn: import("../lib/types").ChannelConnection): void;
}

function ChannelConnectModal({ channel, onClose, onConnected }: ChannelModalProps) {
  const [token, setToken] = useState("");
  const [token2, setToken2] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // WhatsApp QR state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<"idle" | "loading" | "scanning" | "done">("idle");

  const mInputClass = "w-full px-3 py-2 text-sm rounded-xl outline-none transition-colors";
  const mInputStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "rgba(255,255,255,0.85)",
  };

  // Start WhatsApp QR flow
  function startQr() {
    setQrStatus("loading");
    setError(null);
    const close = api.openWhatsAppQrStream({
      onQr(dataUrl) {
        setQrDataUrl(dataUrl);
        setQrStatus("scanning");
      },
      onConnected(data) {
        setQrStatus("done");
        void api.listChannelAccounts().then((accounts) => {
          const conn = accounts.find((a) => a.id === data.connectionId);
          if (conn) onConnected(conn);
          else onClose();
        });
      },
      onError(msg) {
        setError(msg);
        setQrStatus("idle");
      },
    });
    return close;
  }

  async function handleTokenConnect() {
    if (!token.trim()) return;
    if (channel.id === "slack" && !token2.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const conn = await api.connectWithToken(channel.id, token.trim(), token2.trim() || undefined);
      onConnected(conn);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-2xl flex flex-col overflow-hidden"
        style={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${channel.color}20`, color: channel.color }}
          >
            {CHANNEL_ICONS[channel.id]}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
              Connect {channel.label}
            </p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              {channel.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-5">
          {error && (
            <p
              className="text-xs px-3 py-2 rounded-lg"
              style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}
            >
              {error}
            </p>
          )}

          {/* WhatsApp QR flow */}
          {channel.authType === "qr" && (
            <>
              {qrStatus === "idle" && (
                <>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Opens a WhatsApp Web session on this device. Scan the QR code with your phone to
                    connect.{" "}
                    <a
                      href={channel.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                      style={{ color: channel.color }}
                    >
                      Learn more ↗
                    </a>
                  </p>
                  <button
                    type="button"
                    onClick={startQr}
                    className="w-full py-2 rounded-xl text-sm font-medium transition-colors"
                    style={{
                      background: `${channel.color}22`,
                      color: channel.color,
                      border: `1px solid ${channel.color}44`,
                    }}
                  >
                    Generate QR Code
                  </button>
                </>
              )}

              {qrStatus === "loading" && (
                <div className="flex items-center justify-center py-8">
                  <div className="text-xs animate-pulse" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Starting WhatsApp Web…
                  </div>
                </div>
              )}

              {qrStatus === "scanning" && qrDataUrl && (
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 rounded-xl" style={{ background: "white" }}>
                    <img src={qrDataUrl} alt="WhatsApp QR Code" className="w-48 h-48" />
                  </div>
                  <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Open WhatsApp → Linked Devices → Link a device
                  </p>
                </div>
              )}

              {qrStatus === "done" && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Check size={16} style={{ color: "#4ade80" }} />
                  <span className="text-sm" style={{ color: "#4ade80" }}>
                    Connected!
                  </span>
                </div>
              )}
            </>
          )}

          {/* Token-based flow (Telegram, Discord, Slack) */}
          {channel.authType === "token" && (
            <>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                <a
                  href={channel.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  style={{ color: channel.color }}
                >
                  Create your {channel.id} bot ↗
                </a>{" "}
                and paste the token below.
              </p>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "rgba(255,255,255,0.5)" }}>
                    {channel.tokenLabel ?? "Bot Token"}
                  </label>
                  <input
                    className={mInputClass}
                    style={mInputStyle}
                    placeholder={channel.tokenPlaceholder ?? "Paste token…"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </div>
                {channel.token2Label && (
                  <div>
                    <label
                      className="text-xs mb-1 block"
                      style={{ color: "rgba(255,255,255,0.5)" }}
                    >
                      {channel.token2Label}
                    </label>
                    <input
                      className={mInputClass}
                      style={mInputStyle}
                      placeholder={channel.token2Placeholder ?? "Paste token…"}
                      value={token2}
                      onChange={(e) => setToken2(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleTokenConnect()}
                disabled={saving || !token.trim() || (!!channel.token2Label && !token2.trim())}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  background: `${channel.color}22`,
                  color: channel.color,
                  border: `1px solid ${channel.color}44`,
                }}
              >
                <Link2 size={13} />
                {saving ? "Connecting…" : "Connect"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Channel grid card ────────────────────────────────────────────────────────

interface ChannelCardProps {
  channel: ChannelDescriptor;
  connection: ChannelConnection | undefined;
  onConnect(): void;
  onDisconnect(): void;
}

function ChannelCard({ channel, connection, onConnect, onDisconnect }: ChannelCardProps) {
  const connected = !!connection;
  const accountLabel = connection?.accountName ?? connection?.accountEmail ?? connection?.accountId;

  return (
    <div
      className="rounded-2xl flex flex-col overflow-hidden transition-all"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: connected ? `1px solid ${channel.color}44` : "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        className="h-0.5 w-full"
        style={{ background: connected ? channel.color : "rgba(255,255,255,0.06)" }}
      />
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${channel.color}18`, color: channel.color }}
          >
            {CHANNEL_ICONS[channel.id]}
          </div>
          {connected && (
            <span
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: "rgba(34,197,94,0.12)",
                color: "#4ade80",
                border: "1px solid rgba(34,197,94,0.2)",
              }}
            >
              <Check size={9} />
              Connected
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
            {channel.label}
          </span>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            {accountLabel ?? channel.description}
          </p>
        </div>
        <div className="mt-auto">
          {connected ? (
            <button
              type="button"
              onClick={onDisconnect}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition-colors"
              style={{
                background: "rgba(239,68,68,0.08)",
                color: "#f87171",
                border: "1px solid rgba(239,68,68,0.15)",
              }}
            >
              <Trash2 size={11} />
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: `${channel.color}18`,
                color: channel.color,
                border: `1px solid ${channel.color}35`,
              }}
            >
              <Link2 size={11} />
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function buildProfileDraft(
  existing: ProviderProfile | undefined,
  form: FormState
): ProviderProfile {
  return {
    id: existing?.id ?? `${form.providerType}-${Date.now()}`,
    name: form.name.trim(),
    providerType: form.providerType,
    baseUrl: form.url.trim(),
    apiKey: form.apiKey.trim() || existing?.apiKey || "",
    enabled: true,
  };
}

type Tab = "prompts" | "models" | "channels";

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const tab = searchParams.get("tab");
    if (tab === "models") return "models";
    if (tab === "channels") return "channels";
    return "prompts";
  });

  // Shared settings state
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Prompts tab state
  const [promptsDraft, setPromptsDraft] = useState<{
    defaultSystemPrompt: string;
    titleGenerationEnabled: boolean;
  } | null>(null);
  const [promptsSaving, setPromptsSaving] = useState(false);
  const [promptsSaved, setPromptsSaved] = useState(false);

  // Models tab state
  const [userModels, setUserModels] = useState<UserModel[]>([]);
  const [form, setForm] = useState<FormState>(blankForm("ollama"));
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);
  const [availableSuggestions, setAvailableSuggestions] = useState<string[]>([]);

  // Provider inline editing
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; url: string; apiKey: string }>({
    name: "",
    url: "",
    apiKey: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editShowKey, setEditShowKey] = useState(false);

  // Reset state
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetInput, setResetInput] = useState("");
  const [resetting, setResetting] = useState(false);

  // ASR modal
  const [showAsrSetup, setShowAsrSetup] = useState(false);

  // Default models (right column)
  const [defaultModelsSaved, setDefaultModelsSaved] = useState(false);
  const [asrModelDraft, setAsrModelDraft] = useState("");

  // Channels tab state
  const [channels, setChannels] = useState<ChannelDescriptor[]>([]);
  const [channelAccounts, setChannelAccounts] = useState<ChannelConnection[]>([]);
  const [channelModal, setChannelModal] = useState<ChannelDescriptor | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api.getSettings(),
      api.listUserModels(),
      api.listChannels(),
      api.listChannelAccounts(),
    ])
      .then(([nextSettings, nextUserModels, nextChannels, nextAccounts]) => {
        setSettings(nextSettings);
        setUserModels(nextUserModels);
        setChannels(nextChannels);
        setChannelAccounts(nextAccounts);
        setPromptsDraft({
          defaultSystemPrompt: nextSettings.defaultSystemPrompt,
          titleGenerationEnabled: nextSettings.titleGenerationEnabled,
        });
        setAsrModelDraft(nextSettings.asrModel ?? "");
      })
      .catch((error: unknown) => {
        setPageError(error instanceof Error ? error.message : "Failed to load settings.");
      });
  }, []);

  const groupedModels = useMemo(() => {
    if (!settings) return [];
    return settings.profiles
      .map((profile) => ({
        profile,
        models: userModels.filter((entry) => entry.profileId === profile.id),
      }))
      .filter((group) => group.models.length > 0);
  }, [settings, userModels]);

  async function handleReset() {
    setResetting(true);
    try {
      await api.resetAllData();
      localStorage.clear();
      navigate("/profile");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Reset failed.");
      setResetting(false);
      setResetConfirm(false);
      setResetInput("");
    }
  }

  // ── Channel handlers ─────────────────────────────────────────────────────────

  function handleChannelConnected(conn: ChannelConnection) {
    setChannelAccounts((prev) => [...prev.filter((c) => c.provider !== conn.provider), conn]);
    setChannelModal(null);
  }

  async function handleChannelDisconnect(connection: ChannelConnection) {
    await api.disconnectChannel(connection.id);
    setChannelAccounts((prev) => prev.filter((c) => c.id !== connection.id));
  }

  // ── Prompts handlers ─────────────────────────────────────────────────────────

  async function handleSavePrompts() {
    if (!settings || !promptsDraft) return;
    setPromptsSaving(true);
    try {
      const saved = await api.saveSettings({ ...toMaskedSettings(settings), ...promptsDraft });
      setSettings(saved);
      setPromptsSaved(true);
      setTimeout(() => setPromptsSaved(false), 2500);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setPromptsSaving(false);
    }
  }

  function setProviderType(type: ProviderType) {
    const defaults = PROVIDER_DEFAULTS[type];
    setForm((current) => ({
      ...current,
      providerType: type,
      url: defaults.url,
      name: defaults.label,
    }));
    setFormError(null);
  }

  function patchForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setFormError(null);
  }

  async function handleAddModel() {
    if (!settings) return;
    const { providerType, name, modelId, url, apiKey } = form;
    if (!modelId.trim() || !url.trim() || !name.trim()) {
      setFormError("Provider name, URL, and Model ID are required.");
      return;
    }
    setValidating(true);
    setFormError(null);
    setAvailableSuggestions([]);
    try {
      const validation = await api.validateProvider({
        providerType,
        baseUrl: url.trim(),
        apiKey: apiKey.trim() || undefined,
        model: modelId.trim(),
      });
      if (!validation.supported) {
        setFormError(validation.error ?? `Model "${modelId}" not found on this provider.`);
        setAvailableSuggestions(validation.availableModels ?? []);
        return;
      }
      const existingProfile = settings.profiles.find(
        (profile) =>
          profile.providerType === providerType &&
          profile.baseUrl === url.trim() &&
          profile.name === name.trim()
      );
      const profileDraft = buildProfileDraft(existingProfile, form);
      // Merge model capabilities (keep existing per-model caps, add/update this model)
      profileDraft.modelCapabilities = {
        ...(existingProfile?.modelCapabilities ?? {}),
        [modelId.trim()]: form.capabilities,
      };
      const nextSettings: AppSettings = {
        ...toMaskedSettings(settings),
        activeProfileId: profileDraft.id,
        profiles: existingProfile
          ? settings.profiles.map((profile) =>
              profile.id === existingProfile.id
                ? profileDraft
                : { ...profile, apiKey: profile.apiKey ? MASKED : profile.apiKey }
            )
          : [...toMaskedSettings(settings).profiles, profileDraft],
      };
      const savedSettings = await api.saveSettings(nextSettings);
      const createdModel = await api.createUserModel({
        profileId: profileDraft.id,
        model: modelId.trim(),
      });
      setSettings(savedSettings);
      setUserModels((current) => {
        if (current.some((entry) => entry.id === createdModel.id)) return current;
        return [...current, createdModel];
      });
      setForm(blankForm(providerType));
      setFormSuccess(true);
      setTimeout(() => setFormSuccess(false), 2500);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save model.");
    } finally {
      setValidating(false);
    }
  }

  async function handleRemoveModel(model: UserModel) {
    try {
      await api.deleteUserModel(model.id);
      setUserModels((current) => current.filter((entry) => entry.id !== model.id));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to delete model.");
    }
  }

  function startEditProfile(profile: ProviderProfile) {
    setEditingProfileId(profile.id);
    setEditForm({ name: profile.name, url: profile.baseUrl, apiKey: profile.apiKey ?? "" });
    setEditError(null);
    setEditShowKey(false);
  }

  async function handleSaveProfile() {
    if (!settings || !editingProfileId) return;
    if (!editForm.name.trim() || !editForm.url.trim()) {
      setEditError("Name and URL are required.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const saved = await api.saveSettings({
        ...toMaskedSettings(settings),
        profiles: settings.profiles.map((p) => {
          if (p.id !== editingProfileId) return { ...p, apiKey: p.apiKey ? MASKED : p.apiKey };
          return {
            ...p,
            name: editForm.name.trim(),
            baseUrl: editForm.url.trim(),
            // Only update apiKey if user changed it (not masked sentinel, not empty when key existed)
            apiKey:
              editForm.apiKey === MASKED
                ? MASKED
                : editForm.apiKey.trim() || (p.apiKey ? MASKED : ""),
          };
        }),
      });
      setSettings(saved);
      setEditingProfileId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setEditSaving(false);
    }
  }

  function modelKey(profileId: string, model: string) {
    return `${profileId}|||${model}`;
  }

  function parseModelKey(key: string): { profileId: string; model: string } | null {
    const idx = key.indexOf("|||");
    if (idx < 0) return null;
    const profileId = key.slice(0, idx);
    const model = key.slice(idx + 3);
    return profileId && model ? { profileId, model } : null;
  }

  function flashSaved() {
    setDefaultModelsSaved(true);
    setTimeout(() => setDefaultModelsSaved(false), 2000);
  }

  async function handleSaveChatDefault(key: string) {
    if (!settings) return;
    const parsed = parseModelKey(key);
    if (!parsed) return;
    const masked = toMaskedSettings(settings);
    const saved = await api.saveSettings({
      ...masked,
      activeProfileId: parsed.profileId,
      profiles: masked.profiles.map((p) =>
        p.id === parsed.profileId ? { ...p, defaultModel: parsed.model } : p
      ),
    });
    setSettings(saved);
    flashSaved();
  }

  async function handleSaveMemoryDefault(key: string) {
    if (!settings) return;
    const masked = toMaskedSettings(settings);
    let saved: AppSettings;
    if (key === "") {
      const {
        defaultMemoryProfileId: _a,
        defaultMemoryModel: _b,
        ...rest
      } = masked as AppSettings & { defaultMemoryProfileId?: string; defaultMemoryModel?: string };
      saved = await api.saveSettings(rest as AppSettings);
    } else {
      const parsed = parseModelKey(key);
      if (!parsed) return;
      saved = await api.saveSettings({
        ...masked,
        defaultMemoryProfileId: parsed.profileId,
        defaultMemoryModel: parsed.model,
      });
    }
    setSettings(saved);
    flashSaved();
  }

  async function handleSaveAsrModel() {
    if (!settings) return;
    const saved = await api.saveSettings({
      ...toMaskedSettings(settings),
      asrModel: asrModelDraft,
    });
    setSettings(saved);
    flashSaved();
  }

  async function handleToggleCapability(
    profile: ProviderProfile,
    modelName: string,
    capability: string
  ) {
    if (!settings) return;
    const current = profile.modelCapabilities?.[modelName] ?? ["text"];
    const has = current.includes(capability);
    const next = has ? current.filter((c) => c !== capability) : [...current, capability];
    const updatedProfile: ProviderProfile = {
      ...profile,
      modelCapabilities: { ...profile.modelCapabilities, [modelName]: next },
    };
    try {
      const saved = await api.saveSettings({
        ...toMaskedSettings(settings),
        profiles: settings.profiles.map((p) =>
          p.id === profile.id ? updatedProfile : { ...p, apiKey: p.apiKey ? MASKED : p.apiKey }
        ),
      });
      setSettings(saved);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  if (!settings || !promptsDraft) {
    return (
      <div
        className="flex items-center justify-center h-screen text-sm"
        style={{ background: "#1a1915", color: "rgba(255,255,255,0.4)" }}
      >
        {pageError ?? "Loading..."}
      </div>
    );
  }

  const defaults = PROVIDER_DEFAULTS[form.providerType];

  return (
    <div
      className="min-h-screen flex flex-col w-full h-full max-h-screen overflow-hidden"
      style={{ background: "#1a1915", color: "rgba(255,255,255,0.9)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-4 px-6 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm"
          style={{ color: "rgba(255,255,255,0.45)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.85)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.45)")}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <span className="text-sm font-semibold">Settings</span>
      </div>
      <div className="flex flex-1 h-full overflow-hidden">
        {pageError && (
          <div
            className="mx-6 mt-4 px-4 py-3 rounded-xl text-sm flex items-center gap-2"
            style={{ background: "rgba(248,113,113,0.08)", color: "#f87171" }}
          >
            <span className="flex-1">{pageError}</span>
            <button type="button" onClick={() => setPageError(null)}>
              <X size={13} />
            </button>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex flex-col gap-1 px-6 pt-5 pb-1">
          {(["prompts", "models", "channels"] as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 rounded-lg text-[16px]! text-left font-medium capitalize transition-colors"
              style={{
                background: activeTab === tab ? "rgba(255,255,255,0.1)" : "transparent",
                color: activeTab === tab ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                border:
                  activeTab === tab ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="w-full px-6 py-8 flex-1 h-full overflow-y-auto">
          {/* ── Prompts tab ─────────────────────────────────────────────────── */}
          {activeTab === "prompts" && (
            <div className="space-y-6 max-w-2xl mx-auto ">
              <section>
                <h2 className="text-sm font-semibold mb-1">Default system prompt</h2>
                <p className="text-xs mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Applied to every new conversation unless overridden.
                </p>
                <textarea
                  rows={8}
                  value={promptsDraft.defaultSystemPrompt}
                  onChange={(e) =>
                    setPromptsDraft({ ...promptsDraft, defaultSystemPrompt: e.target.value })
                  }
                  className="w-full px-3 py-2.5 text-sm rounded-xl outline-none resize-y"
                  style={{ ...inputStyle, minHeight: 120 }}
                  placeholder="You are a helpful assistant…"
                />
              </section>

              <section>
                <h2 className="text-sm font-semibold mb-3">Behaviour</h2>
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={promptsDraft.titleGenerationEnabled}
                    onChange={(e) =>
                      setPromptsDraft({ ...promptsDraft, titleGenerationEnabled: e.target.checked })
                    }
                    className="w-4 h-4 rounded"
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <div>
                    <span className="text-sm">Generate conversation titles automatically</span>
                    <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                      Titles are generated in the background after the first message.
                    </p>
                  </div>
                </label>
              </section>

              <button
                type="button"
                onClick={() => void handleSavePrompts()}
                disabled={promptsSaving}
                className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium disabled:opacity-40"
                style={{
                  background: "rgba(255,255,255,0.09)",
                  color: "rgba(255,255,255,0.9)",
                  border: "1px solid rgba(255,255,255,0.11)",
                }}
              >
                {promptsSaving ? (
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{
                      border: "2px solid rgba(255,255,255,0.2)",
                      borderTopColor: "rgba(255,255,255,0.8)",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                ) : promptsSaved ? (
                  <Check size={14} />
                ) : null}
                {promptsSaving ? "Saving…" : promptsSaved ? "Saved!" : "Save"}
              </button>

              {/* Danger zone */}
              <section
                className="mt-8 p-4 rounded-xl"
                style={{
                  border: "1px solid rgba(248,113,113,0.2)",
                  background: "rgba(248,113,113,0.04)",
                }}
              >
                <h2 className="text-sm font-semibold mb-1" style={{ color: "#f87171" }}>
                  Danger zone
                </h2>
                <p className="text-xs mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Permanently deletes all conversations, schedules, memory, and profile data. This
                  cannot be undone.
                </p>
                {!resetConfirm ? (
                  <button
                    type="button"
                    onClick={() => setResetConfirm(true)}
                    className="px-4 py-2 text-sm rounded-xl font-medium"
                    style={{
                      background: "rgba(248,113,113,0.1)",
                      color: "#f87171",
                      border: "1px solid rgba(248,113,113,0.25)",
                    }}
                  >
                    Reset all data
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
                      Type{" "}
                      <span style={{ color: "#f87171", fontFamily: "monospace" }}>
                        reset everything
                      </span>{" "}
                      to confirm.
                    </p>
                    <input
                      type="text"
                      value={resetInput}
                      onChange={(e) => setResetInput(e.target.value)}
                      placeholder="reset everything"
                      className={`${inputClass} text-sm`}
                      style={inputStyle}
                      autoFocus
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleReset()}
                        disabled={resetting || resetInput !== "reset everything"}
                        className="px-4 py-2 text-sm rounded-xl font-medium disabled:opacity-40"
                        style={{ background: "#ef4444", color: "#fff", border: "none" }}
                      >
                        {resetting ? "Resetting…" : "Reset everything"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResetConfirm(false);
                          setResetInput("");
                        }}
                        className="px-3 py-2 text-sm rounded-xl"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ── Models tab ──────────────────────────────────────────────────── */}
          {activeTab === "models" && (
            <div className="flex gap-10 max-w-5xl mx-auto items-start flex flex-wrap">
              <div className="flex-1 space-y-10 flex flex-col w-fit max-w-full">
                {/* Add model form */}
                <section>
                  <h2 className="text-sm font-semibold mb-5">Add a model</h2>

                  <div className="flex gap-2 mb-5">
                    {(["ollama", "openai", "vllm"] as ProviderType[]).map((type) => {
                      const active = form.providerType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setProviderType(type)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium"
                          style={{
                            background: active
                              ? "rgba(255,255,255,0.12)"
                              : "rgba(255,255,255,0.04)",
                            border: `1px solid ${active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)"}`,
                            color: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                          }}
                        >
                          {PROVIDER_DEFAULTS[type].label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label
                        className="block text-xs mb-1.5"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        Provider name
                      </label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => patchForm({ name: e.target.value })}
                        className={inputClass}
                        style={inputStyle}
                        placeholder={defaults.label}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs mb-1.5"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        Model ID
                      </label>
                      <input
                        type="text"
                        value={form.modelId}
                        onChange={(e) => patchForm({ modelId: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleAddModel();
                        }}
                        className={inputClass}
                        style={inputStyle}
                        placeholder={defaults.placeholder}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs mb-1.5"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        {form.providerType === "openai" ? "Base URL" : "Server URL"}
                      </label>
                      <input
                        type="url"
                        value={form.url}
                        onChange={(e) => patchForm({ url: e.target.value })}
                        className={inputClass}
                        style={inputStyle}
                        placeholder={defaults.url}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs mb-1.5"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        Input capabilities
                      </label>
                      <div className="flex gap-4">
                        <label
                          className="flex items-center gap-1.5 text-xs select-none cursor-default"
                          style={{ color: "rgba(255,255,255,0.35)" }}
                        >
                          <input
                            type="checkbox"
                            checked
                            readOnly
                            disabled
                            className="w-3.5 h-3.5"
                            style={{ accentColor: "var(--accent)" }}
                          />
                          Text
                        </label>
                        <label
                          className="flex items-center gap-1.5 text-xs select-none cursor-pointer"
                          style={{
                            color: form.capabilities.includes("image")
                              ? "rgba(255,255,255,0.8)"
                              : "rgba(255,255,255,0.4)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={form.capabilities.includes("image")}
                            onChange={(e) =>
                              patchForm({
                                capabilities: e.target.checked
                                  ? [...form.capabilities, "image"]
                                  : form.capabilities.filter((c) => c !== "image"),
                              })
                            }
                            className="w-3.5 h-3.5"
                            style={{ accentColor: "var(--accent)" }}
                          />
                          Image
                        </label>
                      </div>
                    </div>

                    {defaults.needsKey && (
                      <div>
                        <label
                          className="block text-xs mb-1.5"
                          style={{ color: "rgba(255,255,255,0.4)" }}
                        >
                          API Key{" "}
                          <span style={{ color: "rgba(255,255,255,0.22)" }}>encrypted at rest</span>
                        </label>
                        <div className="relative">
                          <input
                            type={showKey ? "text" : "password"}
                            value={form.apiKey}
                            onChange={(e) => patchForm({ apiKey: e.target.value })}
                            className={`${inputClass} pr-10`}
                            style={inputStyle}
                            placeholder="sk-..."
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            tabIndex={-1}
                            className="absolute right-3 top-1/2 -translate-y-1/2"
                            style={{ color: "rgba(255,255,255,0.3)" }}
                            onClick={() => setShowKey((v) => !v)}
                          >
                            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {formError && (
                    <div className="mt-3">
                      <p className="text-xs" style={{ color: "#f87171" }}>
                        {formError}
                      </p>
                      {availableSuggestions.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs mb-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                            Models found on this provider — click to use:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {availableSuggestions.map((entry) => (
                              <button
                                key={entry}
                                type="button"
                                onClick={() => {
                                  patchForm({ modelId: entry });
                                  setAvailableSuggestions([]);
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs"
                                style={{
                                  background: "rgba(255,255,255,0.07)",
                                  border: "1px solid rgba(255,255,255,0.1)",
                                  color: "rgba(255,255,255,0.75)",
                                }}
                              >
                                {entry}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleAddModel()}
                    disabled={
                      validating || !form.modelId.trim() || !form.url.trim() || !form.name.trim()
                    }
                    className="mt-4 flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl font-medium disabled:opacity-40"
                    style={{
                      background: "rgba(255,255,255,0.09)",
                      color: "rgba(255,255,255,0.9)",
                      border: "1px solid rgba(255,255,255,0.11)",
                    }}
                  >
                    {validating ? (
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{
                          border: "2px solid rgba(255,255,255,0.2)",
                          borderTopColor: "rgba(255,255,255,0.8)",
                          animation: "spin 0.7s linear infinite",
                        }}
                      />
                    ) : formSuccess ? (
                      <Check size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    {validating ? "Validating..." : formSuccess ? "Added!" : "Validate & add"}
                  </button>
                </section>

                {/* Provider list */}
                <section>
                  <h2 className="text-sm font-semibold mb-4">Your providers</h2>
                  {groupedModels.length === 0 ? (
                    <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
                      No saved models yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {groupedModels.map(({ profile, models }) => {
                        const isEditing = editingProfileId === profile.id;
                        const needsKey = PROVIDER_DEFAULTS[profile.providerType]?.needsKey;
                        return (
                          <div
                            key={profile.id}
                            className="rounded-xl overflow-hidden"
                            style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                          >
                            {/* Header row */}
                            <div
                              className="px-4 py-3 flex items-start justify-between gap-3"
                              style={{
                                background: "rgba(255,255,255,0.03)",
                                borderBottom: isEditing
                                  ? "1px solid rgba(255,255,255,0.08)"
                                  : "1px solid rgba(255,255,255,0.06)",
                              }}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{profile.name}</p>
                                <p
                                  className="text-xs mt-0.5 space-x-1 truncate"
                                  style={{ color: "rgba(255,255,255,0.35)" }}
                                >
                                  <span>
                                    {PROVIDER_DEFAULTS[profile.providerType]?.label ??
                                      profile.providerType}
                                  </span>
                                  <span>·</span>
                                  <span>{profile.baseUrl}</span>
                                  {profile.apiKey === MASKED && (
                                    <>
                                      <span>·</span>
                                      <span>API key stored</span>
                                    </>
                                  )}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  isEditing ? setEditingProfileId(null) : startEditProfile(profile)
                                }
                                className="shrink-0 mt-0.5"
                                title={isEditing ? "Cancel" : "Edit provider"}
                                style={{
                                  color: isEditing
                                    ? "rgba(255,255,255,0.5)"
                                    : "rgba(255,255,255,0.25)",
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.color = "rgba(255,255,255,0.75)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color = isEditing
                                    ? "rgba(255,255,255,0.5)"
                                    : "rgba(255,255,255,0.25)")
                                }
                              >
                                {isEditing ? <X size={14} /> : <Pencil size={13} />}
                              </button>
                            </div>

                            {/* Inline edit form */}
                            {isEditing && (
                              <div
                                className="px-4 py-4 space-y-3"
                                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                              >
                                <div>
                                  <label
                                    className="block text-xs mb-1.5"
                                    style={{ color: "rgba(255,255,255,0.4)" }}
                                  >
                                    Provider name
                                  </label>
                                  <input
                                    type="text"
                                    value={editForm.name}
                                    onChange={(e) => {
                                      setEditForm((f) => ({ ...f, name: e.target.value }));
                                      setEditError(null);
                                    }}
                                    className={inputClass}
                                    style={inputStyle}
                                    autoFocus
                                  />
                                </div>
                                <div>
                                  <label
                                    className="block text-xs mb-1.5"
                                    style={{ color: "rgba(255,255,255,0.4)" }}
                                  >
                                    {profile.providerType === "openai" ? "Base URL" : "Server URL"}
                                  </label>
                                  <input
                                    type="url"
                                    value={editForm.url}
                                    onChange={(e) => {
                                      setEditForm((f) => ({ ...f, url: e.target.value }));
                                      setEditError(null);
                                    }}
                                    className={inputClass}
                                    style={inputStyle}
                                  />
                                </div>
                                {(needsKey || editForm.apiKey) && (
                                  <div>
                                    <label
                                      className="block text-xs mb-1.5"
                                      style={{ color: "rgba(255,255,255,0.4)" }}
                                    >
                                      API Key{" "}
                                      <span style={{ color: "rgba(255,255,255,0.22)" }}>
                                        leave blank to keep existing
                                      </span>
                                    </label>
                                    <div className="relative">
                                      <input
                                        type={editShowKey ? "text" : "password"}
                                        value={editForm.apiKey === MASKED ? "" : editForm.apiKey}
                                        placeholder={
                                          editForm.apiKey === MASKED
                                            ? "••••••••  (stored)"
                                            : "sk-..."
                                        }
                                        onChange={(e) => {
                                          setEditForm((f) => ({ ...f, apiKey: e.target.value }));
                                          setEditError(null);
                                        }}
                                        className={`${inputClass} pr-10`}
                                        style={inputStyle}
                                        autoComplete="off"
                                      />
                                      <button
                                        type="button"
                                        tabIndex={-1}
                                        className="absolute right-3 top-1/2 -translate-y-1/2"
                                        style={{ color: "rgba(255,255,255,0.3)" }}
                                        onClick={() => setEditShowKey((v) => !v)}
                                      >
                                        {editShowKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {editError && (
                                  <p className="text-xs" style={{ color: "#f87171" }}>
                                    {editError}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => void handleSaveProfile()}
                                    disabled={editSaving}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
                                    style={{
                                      background: "rgba(255,255,255,0.09)",
                                      color: "rgba(255,255,255,0.9)",
                                      border: "1px solid rgba(255,255,255,0.11)",
                                    }}
                                  >
                                    {editSaving ? (
                                      <div
                                        className="w-3 h-3 rounded-full"
                                        style={{
                                          border: "2px solid rgba(255,255,255,0.2)",
                                          borderTopColor: "rgba(255,255,255,0.8)",
                                          animation: "spin 0.7s linear infinite",
                                        }}
                                      />
                                    ) : (
                                      <Check size={12} />
                                    )}
                                    {editSaving ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingProfileId(null)}
                                    className="px-3 py-1.5 rounded-lg text-xs"
                                    style={{ color: "rgba(255,255,255,0.4)" }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Model rows */}
                            {models.map((entry, index) => {
                              const caps = profile.modelCapabilities?.[entry.model] ?? ["text"];
                              const hasImage = caps.includes("image");
                              return (
                                <div
                                  key={entry.id}
                                  className="flex items-center justify-between px-4 py-2.5 group"
                                  style={{
                                    borderTop:
                                      index === 0 && !isEditing
                                        ? "none"
                                        : "1px solid rgba(255,255,255,0.05)",
                                  }}
                                >
                                  <span
                                    className="text-sm"
                                    style={{ color: "rgba(255,255,255,0.75)" }}
                                  >
                                    {entry.model}
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="px-1.5 py-0.5 rounded text-xs"
                                      style={{
                                        background: "rgba(255,255,255,0.05)",
                                        color: "rgba(255,255,255,0.3)",
                                        border: "1px solid rgba(255,255,255,0.07)",
                                      }}
                                    >
                                      Text
                                    </span>
                                    <button
                                      type="button"
                                      title={
                                        hasImage
                                          ? "Remove image capability"
                                          : "Add image capability"
                                      }
                                      onClick={() =>
                                        void handleToggleCapability(profile, entry.model, "image")
                                      }
                                      className="px-1.5 py-0.5 rounded text-xs transition-all"
                                      style={{
                                        background: hasImage
                                          ? "rgba(99,179,237,0.1)"
                                          : "rgba(255,255,255,0.03)",
                                        color: hasImage
                                          ? "rgba(147,197,253,0.8)"
                                          : "rgba(255,255,255,0.2)",
                                        border: `1px solid ${hasImage ? "rgba(147,197,253,0.18)" : "rgba(255,255,255,0.06)"}`,
                                      }}
                                    >
                                      {hasImage ? "Image" : "+ Image"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveModel(entry)}
                                      className="opacity-0 group-hover:opacity-100 ml-1 transition-opacity"
                                      style={{ color: "rgba(248,113,113,0.65)" }}
                                      title="Remove model"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Voice & ASR */}
                <section>
                  <h2 className="text-sm font-semibold mb-1">Voice & ASR</h2>
                  <p className="text-xs mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Configure the speech-to-text provider used by the mic button in the chat
                    composer.
                  </p>
                  <div
                    className="flex items-center justify-between gap-3 p-4 rounded-xl"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <Mic size={16} style={{ color: "rgba(255,255,255,0.4)" }} />
                      <div>
                        <p className="text-sm">
                          {settings.asrProvider ? (
                            (ASR_PROVIDER_LABELS[settings.asrProvider] ?? settings.asrProvider)
                          ) : (
                            <span style={{ color: "rgba(255,255,255,0.4)" }}>Not configured</span>
                          )}
                        </p>
                        {settings.asrProvider && settings.asrBaseUrl && (
                          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                            {settings.asrBaseUrl}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAsrSetup(true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium shrink-0"
                      style={{
                        background: "rgba(255,255,255,0.07)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.7)",
                      }}
                    >
                      {settings.asrProvider ? "Change" : "Set up"}
                    </button>
                  </div>
                </section>
              </div>

              {/* Right column — Default models per group */}
              <div className="max-md:w-full w-64 shrink-0 space-y-5">
                <div>
                  <h2 className="text-sm font-semibold mb-1">Default models</h2>
                  <p className="text-xs mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Choose the model used for each feature.
                  </p>

                  <div className="space-y-4">
                    {/* Chat */}
                    <div>
                      <label
                        className="block text-xs mb-1.5"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        Chat
                      </label>
                      <select
                        value={(() => {
                          const p = settings.profiles.find(
                            (x) => x.id === settings.activeProfileId
                          );
                          const m =
                            p?.defaultModel ??
                            userModels.find((x) => x.profileId === settings.activeProfileId)
                              ?.model ??
                            "";
                          return p && m ? modelKey(p.id, m) : "";
                        })()}
                        onChange={(e) => void handleSaveChatDefault(e.target.value)}
                        className={inputClass}
                        style={inputStyle}
                      >
                        {userModels.length === 0 && <option value="">No models added</option>}
                        {userModels.map((m) => (
                          <option key={m.id} value={modelKey(m.profileId, m.model)}>
                            {m.profileName} / {m.model}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Memory */}
                    <div>
                      <label
                        className="block text-xs mb-1.5"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        Memory
                      </label>
                      <select
                        value={
                          settings.defaultMemoryProfileId && settings.defaultMemoryModel
                            ? modelKey(settings.defaultMemoryProfileId, settings.defaultMemoryModel)
                            : ""
                        }
                        onChange={(e) => void handleSaveMemoryDefault(e.target.value)}
                        className={inputClass}
                        style={inputStyle}
                      >
                        <option value="">Same as chat</option>
                        {userModels.map((m) => (
                          <option key={m.id} value={modelKey(m.profileId, m.model)}>
                            {m.profileName} / {m.model}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* ASR model */}
                    <div>
                      <label
                        className="block text-xs mb-1.5"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        ASR model
                        {settings.asrProvider && (
                          <span className="ml-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>
                            ({ASR_PROVIDER_LABELS[settings.asrProvider] ?? settings.asrProvider})
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={asrModelDraft}
                        onChange={(e) => setAsrModelDraft(e.target.value)}
                        onBlur={() => void handleSaveAsrModel()}
                        className={inputClass}
                        style={inputStyle}
                        placeholder={
                          settings.asrProvider ? "e.g. whisper-large-v3" : "Configure ASR first"
                        }
                        disabled={!settings.asrProvider}
                      />
                    </div>

                    {defaultModelsSaved && (
                      <div
                        className="flex items-center gap-1.5 text-xs"
                        style={{ color: "rgba(134,239,172,0.75)" }}
                      >
                        <Check size={12} /> Saved
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Channels tab ────────────────────────────────────────────── */}
          {activeTab === "channels" && (
            <div className="flex flex-col gap-5">
              {channelError && (
                <div
                  className="flex items-start gap-2 px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: "rgba(239,68,68,0.12)",
                    color: "#f87171",
                    border: "1px solid rgba(239,68,68,0.2)",
                  }}
                >
                  <X size={14} className="mt-0.5 flex-shrink-0" />
                  <span className="flex-1">{channelError}</span>
                  <button
                    type="button"
                    onClick={() => setChannelError(null)}
                    style={{ color: "#f87171" }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                Connect external services. Credentials are encrypted and stored only on your device.
              </p>
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
              >
                {channels.map((channel) => {
                  const connection = channelAccounts.find((c) => c.provider === channel.id);
                  return (
                    <ChannelCard
                      key={channel.id}
                      channel={channel}
                      connection={connection}
                      onConnect={() => setChannelModal(channel)}
                      onDisconnect={() => {
                        void handleChannelDisconnect(connection!);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Channel connect modal */}
        {channelModal && (
          <ChannelConnectModal
            channel={channelModal}
            onClose={() => setChannelModal(null)}
            onConnected={handleChannelConnected}
          />
        )}

        {/* ASR setup modal — anchored to bottom-right so popover appears above */}
        {showAsrSetup && (
          <div className="fixed bottom-6 right-6" style={{ position: "fixed" }}>
            <ASRSetupModal
              settings={settings}
              onDone={async (updates) => {
                try {
                  const saved = await api.saveSettings({
                    ...toMaskedSettings(settings),
                    ...updates,
                  });
                  setSettings(saved);
                  if (updates.asrModel !== undefined) setAsrModelDraft(updates.asrModel ?? "");
                } catch {
                  // ignore
                }
                setShowAsrSetup(false);
              }}
              onClose={() => setShowAsrSetup(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
