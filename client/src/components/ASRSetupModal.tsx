import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Cpu,
  Globe,
  Loader2,
  Mic,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AppSettings, AsrProvider, SystemInfo } from "../lib/types";

// ─── Provider definitions ────────────────────────────────────────────────────

interface ProviderDef {
  key: AsrProvider;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  defaultBaseUrl: string;
  defaultModel: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
}

const PROVIDERS: ProviderDef[] = [
  {
    key: "vllm",
    label: "Qwen3-ASR 1.7B",
    sublabel: "Local · GPU · Best quality",
    icon: <Cpu size={16} />,
    defaultBaseUrl: "http://localhost:8000/v1",
    defaultModel: "Qwen/Qwen3-ASR-1.7B",
    needsApiKey: false,
    needsBaseUrl: true,
  },
  {
    key: "vllm-small",
    label: "Qwen3-ASR 0.6B",
    sublabel: "Local · GPU · Lightweight",
    icon: <Cpu size={16} />,
    defaultBaseUrl: "http://localhost:8000/v1",
    defaultModel: "Qwen/Qwen3-ASR-0.6B",
    needsApiKey: false,
    needsBaseUrl: true,
  },
  {
    key: "localai",
    label: "Whisper (LocalAI)",
    sublabel: "Local · CPU · No GPU needed",
    icon: <Cpu size={16} />,
    defaultBaseUrl: "http://localhost:8080/v1",
    defaultModel: "whisper-1",
    needsApiKey: false,
    needsBaseUrl: true,
  },
  {
    key: "browser",
    label: "Browser dictation",
    sublabel: "Built-in · Chrome/Edge only · Sends audio to Google",
    icon: <Globe size={16} />,
    defaultBaseUrl: "",
    defaultModel: "",
    needsApiKey: false,
    needsBaseUrl: false,
  },
  {
    key: "groq",
    label: "Groq (cloud)",
    sublabel: "Cloud · Ultra-fast · Whisper Large v3",
    icon: <Zap size={16} />,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "whisper-large-v3",
    needsApiKey: true,
    needsBaseUrl: false,
  },
  {
    key: "dashscope",
    label: "Qwen3-ASR (Dashscope)",
    sublabel: "Cloud · Alibaba · Native Qwen3-ASR",
    icon: <Zap size={16} />,
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-asr-1.7b",
    needsApiKey: true,
    needsBaseUrl: false,
  },
  {
    key: "openai",
    label: "OpenAI Whisper",
    sublabel: "Cloud · OpenAI · $0.006/min",
    icon: <Zap size={16} />,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "whisper-1",
    needsApiKey: true,
    needsBaseUrl: false,
  },
];

// ─── Recommendation logic ────────────────────────────────────────────────────

function getRecommendation(info: SystemInfo): AsrProvider {
  const vram = info.gpu?.vramMb ?? 0;
  if (info.vllmRunning) return "vllm";
  if (vram >= 4096) return "vllm";
  if (vram >= 2048) return "vllm-small";
  if (info.localAiRunning) return "localai";
  if (info.ramMb >= 4096) return "localai";
  return "browser";
}

function getAdvisory(
  key: AsrProvider,
  info: SystemInfo
): { type: "ok" | "warn" | "bad"; text: string } {
  const vram = info.gpu?.vramMb ?? 0;
  switch (key) {
    case "vllm":
      if (info.vllmRunning) return { type: "ok", text: "vLLM detected running — ready to use" };
      if (vram >= 4096)
        return {
          type: "ok",
          text: `GPU detected (${info.gpu!.name}, ${Math.round(vram / 1024)}GB) — sufficient for this model`,
        };
      if (vram > 0)
        return {
          type: "warn",
          text: `GPU only has ${Math.round(vram / 1024)}GB VRAM — may run out of memory (needs ≥ 4GB)`,
        };
      return {
        type: "bad",
        text: "No NVIDIA GPU detected — start vLLM manually or pick a different option",
      };
    case "vllm-small":
      if (info.vllmRunning) return { type: "ok", text: "vLLM detected running — ready to use" };
      if (vram >= 2048)
        return {
          type: "ok",
          text: `GPU detected (${info.gpu?.name}, ${Math.round(vram / 1024)}GB) — sufficient`,
        };
      if (vram > 0)
        return {
          type: "warn",
          text: `GPU has ${Math.round(vram / 1024)}GB VRAM — may be tight (needs ≥ 2GB)`,
        };
      return { type: "bad", text: "No GPU detected — may be very slow on CPU" };
    case "localai":
      if (info.localAiRunning)
        return { type: "ok", text: "LocalAI detected running — ready to use" };
      if (info.ramMb >= 4096)
        return {
          type: "ok",
          text: `${Math.round(info.ramMb / 1024)}GB RAM — sufficient for CPU inference`,
        };
      return {
        type: "warn",
        text: `Only ${Math.round(info.ramMb / 1024)}GB RAM detected — may be slow`,
      };
    case "browser":
      return {
        type: "warn",
        text: "Audio is sent to Google's servers — not private. Only works in Chrome/Edge.",
      };
    case "groq":
    case "dashscope":
    case "openai":
      return { type: "ok", text: "Requires internet connection and a valid API key" };
  }
}

// ─── Provider card ───────────────────────────────────────────────────────────

function ProviderCard({
  def,
  isRecommended,
  advisory,
  isExpanded,
  onToggle,
  onSelect,
  settings,
}: {
  def: ProviderDef;
  isRecommended: boolean;
  advisory: { type: "ok" | "warn" | "bad"; text: string };
  isExpanded: boolean;
  onToggle(): void;
  onSelect(cfg: { asrBaseUrl: string; asrApiKey: string; asrModel: string }): void;
  settings: AppSettings | null;
}) {
  const [baseUrl, setBaseUrl] = useState(def.defaultBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(def.defaultModel);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Pre-fill from saved settings when card opens
  useEffect(() => {
    if (!isExpanded || !settings?.asrProvider || settings.asrProvider !== def.key) return;
    if (settings.asrBaseUrl) setBaseUrl(settings.asrBaseUrl);
    if (settings.asrModel) setModel(settings.asrModel);
  }, [isExpanded, def.key, settings]);

  async function handleUse() {
    setValidationError(null);
    setValidating(true);
    try {
      const result = await api.validateAsrConfig({
        asrProvider: def.key,
        asrBaseUrl: baseUrl || undefined,
        asrApiKey: apiKey || undefined,
        asrModel: model || undefined,
      });
      if (!result.ok) {
        setValidationError(result.error ?? "Validation failed");
        return;
      }
      onSelect({ asrBaseUrl: baseUrl, asrApiKey: apiKey, asrModel: model });
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  const advisoryColor =
    advisory.type === "ok"
      ? "text-green-400"
      : advisory.type === "warn"
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: isExpanded
          ? "1px solid rgba(255,255,255,0.15)"
          : "1px solid rgba(255,255,255,0.06)",
        background: isExpanded ? "rgba(255,255,255,0.04)" : "transparent",
      }}
    >
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
        style={{ background: "transparent" }}
        onClick={onToggle}
      >
        <span className="text-[var(--text-muted)]">{def.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text)]">{def.label}</span>
            {isRecommended && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white uppercase tracking-wider">
                Recommended
              </span>
            )}
          </div>
          <span className="text-xs text-[var(--text-muted)]">{def.sublabel}</span>
        </div>
        {isExpanded ? (
          <ChevronUp size={14} className="text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          <p className={`text-xs ${advisoryColor}`}>{advisory.text}</p>

          {def.needsBaseUrl && (
            <label className="block space-y-1">
              <span className="text-xs text-[var(--text-muted)]">Base URL</span>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={def.defaultBaseUrl}
                className="w-full px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-soft)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          )}

          {def.needsApiKey && (
            <label className="block space-y-1">
              <span className="text-xs text-[var(--text-muted)]">API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-soft)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          )}

          {(def.needsBaseUrl || def.needsApiKey) && (
            <label className="block space-y-1">
              <span className="text-xs text-[var(--text-muted)]">Model</span>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={def.defaultModel}
                className="w-full px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-soft)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          )}

          {validationError && (
            <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2 break-words">
              {validationError}
            </p>
          )}

          <button
            type="button"
            disabled={validating}
            onClick={() => void handleUse()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-[var(--accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {validating ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Checking…
              </>
            ) : (
              <>
                <CheckCircle size={13} /> Use this
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main modal ──────────────────────────────────────────────────────────────

interface ASRSetupModalProps {
  settings: AppSettings | null;
  onDone(updates: Pick<AppSettings, "asrProvider" | "asrBaseUrl" | "asrApiKey" | "asrModel">): void;
  onClose(): void;
}

export function ASRSetupModal({ settings, onDone, onClose }: ASRSetupModalProps) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<AsrProvider | null>(null);

  useEffect(() => {
    api
      .getSystemInfo()
      .then((info) => {
        setSystemInfo(info);
        setExpandedKey(getRecommendation(info));
      })
      .catch(() => setExpandedKey("browser"))
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(
    def: ProviderDef,
    cfg: { asrBaseUrl: string; asrApiKey: string; asrModel: string }
  ) {
    onDone({
      asrProvider: def.key,
      asrBaseUrl: cfg.asrBaseUrl || def.defaultBaseUrl,
      asrApiKey: cfg.asrApiKey,
      asrModel: cfg.asrModel || def.defaultModel,
    });
  }

  return (
    <>
      {/* Click-away backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover anchored above the mic button (bottom-right of composer) */}
      <div
        className="absolute bottom-[calc(100%+10px)] right-0 z-50 w-100 rounded-2xl overflow-hidden flex flex-col shadow-2xl"
        style={{
          background: "var(--bg)",
          border: "1px solid rgba(255,255,255,0.14)",
          maxHeight: "420px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center gap-2">
            <Mic size={16} className="text-[var(--accent)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">Choose ASR provider</p>
              <p className="text-xs text-[var(--text-muted)]">
                Select how to transcribe your voice
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Hardware info banner */}
        {!loading && systemInfo && (
          <div
            className="px-5 py-2.5 text-xs text-[var(--text-muted)]"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            {systemInfo.gpu
              ? `GPU: ${systemInfo.gpu.name} (${Math.round(systemInfo.gpu.vramMb / 1024)}GB VRAM) · RAM: ${Math.round(systemInfo.ramMb / 1024)}GB`
              : `No GPU detected · RAM: ${Math.round(systemInfo.ramMb / 1024)}GB`}
            {systemInfo.vllmRunning && " · vLLM running"}
            {systemInfo.localAiRunning && " · LocalAI running"}
          </div>
        )}

        {/* Provider list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-[var(--text-muted)]">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Scanning hardware…</span>
            </div>
          ) : (
            PROVIDERS.map((def) => {
              const recommended = systemInfo ? getRecommendation(systemInfo) === def.key : false;
              const advisory = systemInfo
                ? getAdvisory(def.key, systemInfo)
                : { type: "ok" as const, text: "Hardware scan unavailable" };

              return (
                <ProviderCard
                  key={def.key}
                  def={def}
                  isRecommended={recommended}
                  advisory={advisory}
                  isExpanded={expandedKey === def.key}
                  onToggle={() => setExpandedKey(expandedKey === def.key ? null : def.key)}
                  onSelect={(cfg) => handleSelect(def, cfg)}
                  settings={settings}
                />
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
