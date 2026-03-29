import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Github,
  Link2,
  Linkedin,
  Mail,
  MessageSquare,
  Hash,
  Send,
  Twitter,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { AppSettings, OAuthConnection, OAuthProvider } from "../lib/types";

const MASKED = "__masked__";

// ─── Provider metadata ────────────────────────────────────────────────────────

interface ProviderMeta {
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  authType: "oauth" | "token";
  tokenLabel?: string;
  tokenPlaceholder?: string;
  needsClientCredentials: boolean;
  docsUrl: string;
}

const iconSize = 20;

const PROVIDERS: Record<OAuthProvider, ProviderMeta> = {
  github: {
    label: "GitHub",
    description: "Repositories, issues, pull requests",
    icon: <Github size={iconSize} />,
    color: "#e2e8f0",
    authType: "oauth",
    needsClientCredentials: true,
    docsUrl: "https://docs.github.com/apps/oauth-apps/building-oauth-apps",
  },
  google: {
    label: "Google / Gmail",
    description: "Email, calendar, Google services",
    icon: <Mail size={iconSize} />,
    color: "#ea4335",
    authType: "oauth",
    needsClientCredentials: true,
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },
  discord: {
    label: "Discord",
    description: "Servers, channels, messages",
    icon: <MessageSquare size={iconSize} />,
    color: "#5865f2",
    authType: "oauth",
    needsClientCredentials: true,
    docsUrl: "https://discord.com/developers/applications",
  },
  slack: {
    label: "Slack",
    description: "Workspaces, channels, messages",
    icon: <Hash size={iconSize} />,
    color: "#4a154b",
    authType: "oauth",
    needsClientCredentials: true,
    docsUrl: "https://api.slack.com/apps",
  },
  twitter: {
    label: "Twitter / X",
    description: "Tweets, followers, timelines",
    icon: <Twitter size={iconSize} />,
    color: "#1d9bf0",
    authType: "oauth",
    needsClientCredentials: true,
    docsUrl: "https://developer.twitter.com/en/portal/dashboard",
  },
  linkedin: {
    label: "LinkedIn",
    description: "Profile, posts, connections",
    icon: <Linkedin size={iconSize} />,
    color: "#0a66c2",
    authType: "oauth",
    needsClientCredentials: true,
    docsUrl: "https://www.linkedin.com/developers/apps",
  },
  telegram: {
    label: "Telegram",
    description: "Bot messages, channels",
    icon: <Send size={iconSize} />,
    color: "#0088cc",
    authType: "token",
    tokenLabel: "Bot Token",
    tokenPlaceholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    needsClientCredentials: false,
    docsUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot",
  },
};

const PROVIDER_ORDER: OAuthProvider[] = [
  "github",
  "google",
  "discord",
  "slack",
  "twitter",
  "linkedin",
  "telegram",
];

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputClass = "w-full px-3 py-2 text-sm rounded-xl outline-none transition-colors";
const inputStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.85)",
};

// ─── Provider card ────────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: OAuthProvider;
  meta: ProviderMeta;
  connection: OAuthConnection | undefined;
  appCfg: { clientId: string; clientSecret: string } | undefined;
  onConnect(provider: OAuthProvider): void;
  onDisconnect(connection: OAuthConnection): void;
  onSaveCredentials(provider: OAuthProvider, clientId: string, clientSecret: string): void;
  onSaveToken(provider: OAuthProvider, token: string): void;
}

function ProviderCard({
  provider,
  meta,
  connection,
  appCfg,
  onConnect,
  onDisconnect,
  onSaveCredentials,
  onSaveToken,
}: ProviderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState(appCfg?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState(appCfg?.clientSecret ?? "");
  const [showSecret, setShowSecret] = useState(false);
  const [tokenValue, setTokenValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Sync if parent updates (e.g. after save)
  useEffect(() => {
    setClientId(appCfg?.clientId ?? "");
    setClientSecret(appCfg?.clientSecret ?? "");
  }, [appCfg]);

  const configured = meta.authType === "token" ? true : !!(appCfg?.clientId && appCfg.clientSecret);
  const connected = !!connection;

  async function handleSaveCredentials() {
    setSaving(true);
    try {
      await onSaveCredentials(provider, clientId, clientSecret);
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      await onConnect(provider);
    } finally {
      setConnecting(false);
    }
  }

  async function handleSaveToken() {
    if (!tokenValue.trim()) return;
    setSaving(true);
    try {
      await onSaveToken(provider, tokenValue.trim());
      setTokenValue("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${meta.color}22`, color: meta.color }}
        >
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
              {meta.label}
            </span>
            {connected && (
              <span
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}
              >
                <Check size={10} />
                Connected
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
            {connection
              ? connection.accountName ?? connection.accountEmail ?? connection.accountId
              : meta.description}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {connected ? (
            <button
              type="button"
              onClick={() => onDisconnect(connection!)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{
                background: "rgba(239,68,68,0.12)",
                color: "#f87171",
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              <Trash2 size={12} />
              Disconnect
            </button>
          ) : meta.authType === "oauth" ? (
            <>
              {!configured && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    color: "rgba(255,255,255,0.7)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  Setup
                </button>
              )}
              {configured && (
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50"
                  style={{
                    background: `${meta.color}22`,
                    color: meta.color,
                    border: `1px solid ${meta.color}44`,
                  }}
                >
                  <Link2 size={12} />
                  {connecting ? "Opening…" : "Connect"}
                </button>
              )}
              {appCfg && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{
                    color: "rgba(255,255,255,0.4)",
                    background: expanded ? "rgba(255,255,255,0.08)" : "transparent",
                  }}
                  title="Edit credentials"
                >
                  {expanded ? <X size={14} /> : <Eye size={14} />}
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* OAuth credentials form */}
      {meta.authType === "oauth" && expanded && (
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Register an OAuth app at your provider and enter the credentials below. Use{" "}
            <code
              className="px-1 py-0.5 rounded text-xs"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              http://127.0.0.1:3001/api/connections/{provider}/callback
            </code>{" "}
            as the redirect URI.{" "}
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: meta.color }}
            >
              Docs
            </a>
          </p>
          <input
            className={inputClass}
            style={inputStyle}
            placeholder="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <div className="relative">
            <input
              className={inputClass}
              style={{ ...inputStyle, paddingRight: "2.5rem" }}
              type={showSecret ? "text" : "password"}
              placeholder={clientSecret === MASKED ? "••••••••" : "Client Secret"}
              value={clientSecret === MASKED ? "" : clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              style={{ color: "rgba(255,255,255,0.4)" }}
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveCredentials}
              disabled={saving || !clientId.trim()}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="px-4 py-1.5 rounded-lg text-xs transition-colors"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Telegram token form */}
      {meta.authType === "token" && !connected && (
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Create a bot via{" "}
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: meta.color }}
            >
              @BotFather
            </a>{" "}
            and paste the token below.
          </p>
          <input
            className={inputClass}
            style={inputStyle}
            placeholder={meta.tokenPlaceholder}
            value={tokenValue}
            onChange={(e) => setTokenValue(e.target.value)}
          />
          <button
            type="button"
            onClick={handleSaveToken}
            disabled={saving || !tokenValue.trim()}
            className="self-start px-4 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}44` }}
          >
            {saving ? "Validating…" : "Connect"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ConnectionsPage() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<OAuthConnection[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    void Promise.all([api.listConnections(), api.getSettings()]).then(([conns, cfg]) => {
      setConnections(conns);
      setSettings(cfg);
    });
  }, []);

  // Listen for OAuth popup postMessages
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; provider?: string; message?: string };
      if (data.type === "oauth_success") {
        popupRef.current?.close();
        void api.listConnections().then(setConnections);
      } else if (data.type === "oauth_error") {
        popupRef.current?.close();
        setError(data.message ?? "OAuth failed");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function handleConnect(provider: OAuthProvider) {
    setError(null);
    try {
      const { authUrl } = await api.startOAuthFlow(provider);
      const popup = window.open(authUrl, `oauth_${provider}`, "width=600,height=700,left=200,top=100");
      if (!popup) {
        setError("Popup was blocked. Please allow popups for this page and try again.");
        return;
      }
      popupRef.current = popup;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDisconnect(connection: OAuthConnection) {
    await api.deleteConnection(connection.id);
    setConnections((prev) => prev.filter((c) => c.id !== connection.id));
  }

  async function handleSaveCredentials(
    provider: OAuthProvider,
    clientId: string,
    clientSecret: string
  ) {
    if (!settings) return;
    const secretToSend =
      clientSecret === "" && settings.connections?.[provider]?.clientSecret === MASKED
        ? MASKED
        : clientSecret;
    const updated: AppSettings = {
      ...settings,
      connections: {
        ...settings.connections,
        [provider]: { clientId, clientSecret: secretToSend },
      },
    };
    const saved = await api.saveSettings(updated);
    setSettings(saved);
  }

  async function handleSaveToken(provider: OAuthProvider, token: string) {
    setError(null);
    try {
      const conn = await api.saveTelegramToken(token);
      setConnections((prev) => [...prev.filter((c) => c.provider !== provider), conn]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "#0f0f11", color: "rgba(255,255,255,0.85)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-base font-semibold">Connections</h1>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {error && (
            <div
              className="flex items-start gap-2 px-4 py-3 rounded-xl text-sm"
              style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <X size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="ml-auto flex-shrink-0"
                style={{ color: "#f87171" }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
            Connect external services. OAuth credentials are stored encrypted on your device and never
            leave your machine.
          </p>

          {PROVIDER_ORDER.map((provider) => (
            <ProviderCard
              key={provider}
              provider={provider}
              meta={PROVIDERS[provider]}
              connection={connections.find((c) => c.provider === provider)}
              appCfg={settings?.connections?.[provider]}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onSaveCredentials={handleSaveCredentials}
              onSaveToken={handleSaveToken}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
