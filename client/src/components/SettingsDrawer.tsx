import { Mic, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip } from "./Chip";
import { ASRSetupModal } from "./ASRSetupModal";
import type { AppSettings, UserProfile } from "../lib/types";

// ─── Shared constants (same as onboarding) ───────────────────────────────────

const GENDER_OPTIONS = [
  "Man",
  "Woman",
  "Non-binary",
  "Genderfluid",
  "Agender",
  "Prefer not to say",
];
const RESPONSE_LENGTH_OPTIONS = ["Concise", "Balanced", "Detailed"];
const TONE_OPTIONS = ["Casual", "Professional", "Direct", "Friendly"];
const FOCUS_OPTIONS = ["Coding", "Writing", "Research", "Productivity", "Creative", "Analysis"];

const TODAY = new Date().toISOString().split("T")[0];

// ─── Slider ───────────────────────────────────────────────────────────────────

function SliderField({
  value,
  onChange,
  leftLabel,
  rightLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div className="w-full space-y-1.5">
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ accentColor: "var(--accent)", width: "100%" }}
        className="cursor-pointer"
      />
      <div className="flex justify-between text-xs text-[var(--text-muted)]">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3 mt-5 first:mt-0">
      {children}
    </p>
  );
}

// ─── Field group ─────────────────────────────────────────────────────────────

function FieldGroup({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <span>
        {label}
        {optional && (
          <span style={{ opacity: 0.5, fontWeight: 400, marginLeft: 6 }}>(optional)</span>
        )}
      </span>
      {children}
    </div>
  );
}

// ─── Chips row ────────────────────────────────────────────────────────────────

function ChipsRow({
  options,
  selected,
  onSelect,
  otherActive,
  onSelectOther,
  otherValue,
  onOtherChange,
  otherPlaceholder,
}: {
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
  otherActive: boolean;
  onSelectOther: () => void;
  otherValue: string;
  onOtherChange: (v: string) => void;
  otherPlaceholder?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 pt-1">
        {options.map((opt) => (
          <Chip key={opt} label={opt} selected={selected === opt} onClick={() => onSelect(opt)} />
        ))}
        <Chip label="Other" selected={otherActive} onClick={onSelectOther} />
      </div>
      {otherActive && (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder={otherPlaceholder ?? "Describe…"}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
        />
      )}
    </div>
  );
}

// ─── Multi-chips row ──────────────────────────────────────────────────────────

function MultiChipsRow({
  options,
  selected,
  onToggle,
  otherActive,
  onToggleOther,
  otherValue,
  onOtherChange,
  otherPlaceholder,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  otherActive: boolean;
  onToggleOther: () => void;
  otherValue: string;
  onOtherChange: (v: string) => void;
  otherPlaceholder?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 pt-1">
        {options.map((opt) => (
          <Chip
            key={opt}
            label={opt}
            selected={selected.includes(opt)}
            onClick={() => onToggle(opt)}
          />
        ))}
        <Chip label="Other" selected={otherActive} onClick={onToggleOther} />
      </div>
      {otherActive && (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder={otherPlaceholder ?? "Describe…"}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
        />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SettingsDrawerProps {
  open: boolean;
  settings: AppSettings | null;
  saving: boolean;
  userProfile: UserProfile | null;
  onClose(): void;
  onSave(settings: AppSettings): void;
  onSaveProfile(
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
  ): Promise<void>;
}

const ASR_PROVIDER_LABELS: Record<string, string> = {
  vllm: "Qwen3-ASR 1.7B (local)",
  "vllm-small": "Qwen3-ASR 0.6B (local)",
  localai: "Whisper · LocalAI (local)",
  browser: "Browser dictation",
  groq: "Groq (cloud)",
  dashscope: "Dashscope (cloud)",
  openai: "OpenAI Whisper (cloud)",
};

export function SettingsDrawer(props: SettingsDrawerProps) {
  const [draft, setDraft] = useState<AppSettings | null>(props.settings);
  const [profileSaving, setProfileSaving] = useState(false);
  const [showAsrSetup, setShowAsrSetup] = useState(false);

  // Personal fields
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [gender, setGender] = useState("");
  const [genderOther, setGenderOther] = useState("");

  // Preference fields
  const [responseLength, setResponseLength] = useState("");
  const [responseLengthOther, setResponseLengthOther] = useState("");
  const [tone, setTone] = useState("");
  const [toneOther, setToneOther] = useState("");
  const [toneLevel, setToneLevel] = useState(50);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [focusOtherText, setFocusOtherText] = useState("");
  const [proactiveness, setProactiveness] = useState(50);
  const [extraContext, setExtraContext] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setDraft(props.settings ? JSON.parse(JSON.stringify(props.settings)) : null);

    const p = props.userProfile;
    if (!p) return;

    setName(p.name ?? "");
    setBirthday(p.birthday ?? "");

    const gPredefined = GENDER_OPTIONS.includes(p.gender ?? "");
    setGender(gPredefined ? (p.gender ?? "") : "__other__");
    setGenderOther(gPredefined ? "" : (p.gender ?? ""));

    const rlPredefined = RESPONSE_LENGTH_OPTIONS.includes(p.responseLength ?? "");
    setResponseLength(rlPredefined ? (p.responseLength ?? "") : "__other__");
    setResponseLengthOther(rlPredefined ? "" : (p.responseLength ?? ""));

    const tPredefined = TONE_OPTIONS.includes(p.tone ?? "");
    setTone(tPredefined ? (p.tone ?? "") : "__other__");
    setToneOther(tPredefined ? "" : (p.tone ?? ""));
    setToneLevel(p.toneLevel ?? 50);

    // Focus areas: split predefined vs custom
    const predefinedFocus = (p.focusAreas ?? []).filter((a) => FOCUS_OPTIONS.includes(a));
    const customFocus = (p.focusAreas ?? []).filter((a) => !FOCUS_OPTIONS.includes(a));
    setFocusAreas(predefinedFocus);
    setFocusOtherText(customFocus[0] ?? "");

    setProactiveness(p.proactiveness ?? 50);
    setExtraContext(p.extraContext ?? "");
  }, [props.open, props.settings, props.userProfile]);

  function resolvedGender() {
    return gender === "__other__" ? genderOther.trim() : gender;
  }
  function resolvedResponseLength() {
    return responseLength === "__other__" ? responseLengthOther.trim() : responseLength;
  }
  function resolvedTone() {
    return tone === "__other__" ? toneOther.trim() : tone;
  }
  function resolvedFocusAreas() {
    const custom = focusOtherText.trim();
    return custom ? [...focusAreas, custom] : focusAreas;
  }

  const focusOtherActive =
    focusOtherText !== "" || focusAreas.some((a) => !FOCUS_OPTIONS.includes(a));

  async function handleSaveProfile() {
    setProfileSaving(true);
    try {
      await props.onSaveProfile({
        name: name.trim(),
        birthday: birthday || undefined,
        gender: resolvedGender(),
        responseLength: resolvedResponseLength(),
        tone: resolvedTone(),
        toneLevel,
        focusAreas: resolvedFocusAreas(),
        proactiveness,
        extraContext: extraContext.trim() || undefined,
      });
    } finally {
      setProfileSaving(false);
    }
  }

  if (!props.open || !draft) return null;

  return (
    <>
      {showAsrSetup && (
        <ASRSetupModal
          settings={draft}
          onDone={(updates) => {
            setDraft((d) => (d ? { ...d, ...updates } : d));
            setShowAsrSetup(false);
          }}
          onClose={() => setShowAsrSetup(false)}
        />
      )}
      <div className="drawer-backdrop" onClick={props.onClose}>
        <section className="drawer flex flex-col" onClick={(e) => e.stopPropagation()}>
          <header className="drawer__header">
            <div>
              <span className="sidebar__eyebrow">Settings</span>
              <h2>App settings</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={props.onClose}
              aria-label="Close settings"
            >
              <X size={18} />
            </button>
          </header>
          <div className="w-full flex-1 overflow-y-auto px-4 pb-4">
            {/* ── Personal profile ───────────────────────────────────────── */}
            <div>
              <SectionLabel>Personal profile</SectionLabel>

              {/* Name + Birthday side by side */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <FieldGroup label="Name">
                  <input
                    type="text"
                    placeholder="How should I call you?"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FieldGroup>
                <FieldGroup label="Birthday" optional>
                  <input
                    type="date"
                    max={TODAY}
                    value={birthday}
                    onChange={(e) => setBirthday(e.target.value)}
                    style={{ colorScheme: "dark" }}
                  />
                </FieldGroup>
              </div>

              <FieldGroup label="Gender identity">
                <ChipsRow
                  options={GENDER_OPTIONS}
                  selected={gender}
                  onSelect={(v) => {
                    setGender(v);
                    setGenderOther("");
                  }}
                  otherActive={gender === "__other__"}
                  onSelectOther={() => setGender("__other__")}
                  otherValue={genderOther}
                  onOtherChange={setGenderOther}
                  otherPlaceholder="Describe your identity…"
                />
              </FieldGroup>
            </div>

            {/* ── Preferences ────────────────────────────────────────────── */}
            <div style={{ marginTop: 24 }}>
              <SectionLabel>Preferences</SectionLabel>

              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <FieldGroup label="Response length">
                  <ChipsRow
                    options={RESPONSE_LENGTH_OPTIONS}
                    selected={responseLength}
                    onSelect={(v) => {
                      setResponseLength(v);
                      setResponseLengthOther("");
                    }}
                    otherActive={responseLength === "__other__"}
                    onSelectOther={() => setResponseLength("__other__")}
                    otherValue={responseLengthOther}
                    onOtherChange={setResponseLengthOther}
                    otherPlaceholder="Describe your preference…"
                  />
                </FieldGroup>

                <FieldGroup label="Communication tone">
                  <ChipsRow
                    options={TONE_OPTIONS}
                    selected={tone}
                    onSelect={(v) => {
                      setTone(v);
                      setToneOther("");
                    }}
                    otherActive={tone === "__other__"}
                    onSelectOther={() => setTone("__other__")}
                    otherValue={toneOther}
                    onOtherChange={setToneOther}
                    otherPlaceholder="Describe your preferred tone…"
                  />
                  <div style={{ marginTop: 10 }}>
                    <p className="text-xs text-[var(--text-muted)] mb-2">Formality level</p>
                    <SliderField
                      value={toneLevel}
                      onChange={setToneLevel}
                      leftLabel="Formal"
                      rightLabel="Casual"
                    />
                  </div>
                </FieldGroup>

                <FieldGroup label="Focus areas">
                  <p className="text-xs text-[var(--text-muted)] mb-1">Select all that apply</p>
                  <MultiChipsRow
                    options={FOCUS_OPTIONS}
                    selected={focusAreas}
                    onToggle={(v) =>
                      setFocusAreas((prev) =>
                        prev.includes(v) ? prev.filter((a) => a !== v) : [...prev, v]
                      )
                    }
                    otherActive={focusOtherActive}
                    onToggleOther={() => setFocusOtherText(focusOtherActive ? "" : " ")}
                    otherValue={focusOtherText.trim()}
                    onOtherChange={setFocusOtherText}
                    otherPlaceholder="e.g. data analysis, legal research…"
                  />
                </FieldGroup>

                <FieldGroup label="Proactiveness">
                  <p className="text-xs text-[var(--text-muted)] mb-2">
                    {proactiveness > 66
                      ? "Proactive — I'll suggest ideas and ask follow-up questions."
                      : proactiveness > 33
                        ? "Balanced — I'll offer suggestions when useful."
                        : "Reactive — I'll only answer what you ask."}
                  </p>
                  <SliderField
                    value={proactiveness}
                    onChange={setProactiveness}
                    leftLabel="Just answer"
                    rightLabel="Suggest & guide"
                  />
                </FieldGroup>

                <FieldGroup label="Extra context" optional>
                  <textarea
                    rows={3}
                    placeholder="Your role, background, goals — anything that helps me help you better."
                    value={extraContext}
                    onChange={(e) => setExtraContext(e.target.value)}
                    style={{ resize: "vertical" }}
                  />
                </FieldGroup>
              </div>

              <div style={{ marginTop: 16 }}>
                <button
                  className="primary-button"
                  type="button"
                  disabled={profileSaving || !name.trim()}
                  onClick={() => void handleSaveProfile()}
                >
                  <span>{profileSaving ? "Saving…" : "Save profile"}</span>
                </button>
              </div>
            </div>

            <hr
              style={{ border: "none", borderTop: "0.5px solid var(--border)", margin: "28px 0" }}
            />

            {/* ── App settings ───────────────────────────────────────────── */}
            <SectionLabel>App settings</SectionLabel>

            <label className="field">
              <span>Default system prompt</span>
              <textarea
                rows={4}
                value={draft.defaultSystemPrompt}
                onChange={(e) => setDraft({ ...draft, defaultSystemPrompt: e.target.value })}
              />
            </label>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={draft.titleGenerationEnabled}
                onChange={(e) => setDraft({ ...draft, titleGenerationEnabled: e.target.checked })}
              />
              <span>Generate titles asynchronously in the background</span>
            </label>

            {/* ── ASR / Dictation ────────────────────────────────────────── */}
            <hr
              style={{
                border: "none",
                borderTop: "0.5px solid var(--border)",
                margin: "24px 0 20px",
              }}
            />
            <SectionLabel>Voice dictation</SectionLabel>
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 text-sm text-[var(--text)]">
                <Mic size={14} className="text-[var(--text-muted)]" />
                {draft.asrProvider ? (
                  <span>{ASR_PROVIDER_LABELS[draft.asrProvider] ?? draft.asrProvider}</span>
                ) : (
                  <span className="text-[var(--text-muted)]">Not configured</span>
                )}
              </div>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
                onClick={() => setShowAsrSetup(true)}
              >
                {draft.asrProvider ? "Change" : "Set up"}
              </button>
            </div>

            <div className="drawer__footer">
              <button
                className="primary-button"
                type="button"
                disabled={props.saving}
                onClick={() => props.onSave(draft)}
              >
                <span>{props.saving ? "Saving..." : "Save settings"}</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
