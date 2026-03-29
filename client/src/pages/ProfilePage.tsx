import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip } from "../components/Chip";
import { AppLogo } from "../components/AppLogo";
import { api } from "../lib/api";
import type { UserProfile } from "../lib/types";

// ─── Constants ───────────────────────────────────────────────────────────────

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

const TOTAL_DATA_STEPS = 7;
const SUMMARY_STEP = 8;

const TODAY = new Date().toISOString().split("T")[0];

// ─── Sub-components ──────────────────────────────────────────────────────────

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
    <div className="w-full space-y-2">
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

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex gap-1.5 justify-center mb-6">
      {Array.from({ length: TOTAL_DATA_STEPS }).map((_, i) => (
        <div
          key={i}
          className={[
            "h-1.5 rounded-full transition-all duration-300",
            i + 1 === current
              ? "w-5 bg-[var(--accent)]"
              : i + 1 < current
                ? "w-1.5 bg-[var(--accent)] opacity-50"
                : "w-1.5 bg-[var(--border)]",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
        {children}
      </label>
      {optional && <span className="text-xs text-[var(--text-muted)]">Optional</span>}
    </div>
  );
}

// ─── Summary helpers ─────────────────────────────────────────────────────────

function buildSummaryLines(d: {
  name: string;
  gender: string;
  responseLength: string;
  tone: string;
  toneLevel: number;
  focusAreas: string[];
  proactiveness: number;
}): string[] {
  const lines: string[] = [];

  lines.push(`I'll address you as ${d.name}`);

  if (d.gender && d.gender !== "Prefer not to say") {
    lines.push(`I'll use appropriate pronouns for ${d.gender.toLowerCase()} identity`);
  }

  const lengthMap: Record<string, string> = {
    Concise: "I'll keep responses focused and to the point",
    Balanced: "I'll provide balanced responses with the right context",
    Detailed: "I'll give thorough, detailed responses",
  };
  lines.push(
    lengthMap[d.responseLength] ?? `I'll aim for ${d.responseLength.toLowerCase()} responses`
  );

  const toneMap: Record<string, string> = {
    Casual: "I'll use a relaxed, conversational tone",
    Professional: "I'll use a professional, structured tone",
    Direct: "I'll be direct and straight to the point",
    Friendly: "I'll be warm and approachable",
  };
  const toneBase = toneMap[d.tone] ?? `I'll use a ${d.tone.toLowerCase()} tone`;
  const formalityNote =
    d.toneLevel > 66 ? " (leaning casual)" : d.toneLevel < 34 ? " (leaning formal)" : "";
  lines.push(toneBase + formalityNote);

  if (d.focusAreas.length > 0) {
    const formatted =
      d.focusAreas.length === 1
        ? d.focusAreas[0].toLowerCase()
        : d.focusAreas
            .map((a) => a.toLowerCase())
            .join(", ")
            .replace(/, ([^,]*)$/, " and $1");
    lines.push(`I'll focus on ${formatted}`);
  }

  if (d.proactiveness > 66) {
    lines.push("I'll proactively suggest ideas and ask follow-up questions");
  } else if (d.proactiveness > 33) {
    lines.push("I'll be moderately proactive");
  } else {
    lines.push("I'll stay focused and only respond to what you ask");
  }

  return lines;
}

// ─── Draft state ─────────────────────────────────────────────────────────────

interface DraftState {
  name: string;
  birthday: string;
  gender: string;
  genderOther: string;
  responseLength: string;
  responseLengthOther: string;
  tone: string;
  toneOther: string;
  toneLevel: number;
  focusAreas: string[];
  focusOtherText: string;
  proactiveness: number;
  extraContext: string;
}

const initialDraft: DraftState = {
  name: "",
  birthday: "",
  gender: "",
  genderOther: "",
  responseLength: "",
  responseLengthOther: "",
  tone: "",
  toneOther: "",
  toneLevel: 50,
  focusAreas: [],
  focusOtherText: "",
  proactiveness: 50,
  extraContext: "",
};

function profileToDraft(profile: UserProfile): DraftState {
  const knownGenders = [...GENDER_OPTIONS];
  const knownLengths = RESPONSE_LENGTH_OPTIONS;
  const knownTones = TONE_OPTIONS;

  const gender = knownGenders.includes(profile.gender) ? profile.gender : "__other__";
  const responseLength = knownLengths.includes(profile.responseLength)
    ? profile.responseLength
    : "__other__";
  const tone = knownTones.includes(profile.tone) ? profile.tone : "__other__";

  const knownFocusAreas = profile.focusAreas.filter((a) => FOCUS_OPTIONS.includes(a));
  const customFocusAreas = profile.focusAreas.filter((a) => !FOCUS_OPTIONS.includes(a));

  return {
    name: profile.name,
    birthday: profile.birthday ?? "",
    gender,
    genderOther: gender === "__other__" ? profile.gender : "",
    responseLength,
    responseLengthOther: responseLength === "__other__" ? profile.responseLength : "",
    tone,
    toneOther: tone === "__other__" ? profile.tone : "",
    toneLevel: profile.toneLevel,
    focusAreas: knownFocusAreas,
    focusOtherText: customFocusAreas.join(", "),
    proactiveness: profile.proactiveness,
    extraContext: profile.extraContext ?? "",
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  isFirstTime?: boolean;
  existingProfile?: UserProfile | null;
  onComplete?: (profile: UserProfile) => void;
}

export function ProfilePage({ isFirstTime = false, existingProfile, onComplete }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState(isFirstTime ? 0 : 1);
  const [draft, setDraft] = useState<DraftState>(
    existingProfile ? profileToDraft(existingProfile) : initialDraft
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existingProfile) {
      setDraft(profileToDraft(existingProfile));
      setStep(isFirstTime ? 0 : 1);
    }
  }, [existingProfile, isFirstTime]);

  function resolvedGender() {
    if (draft.gender === "__other__") return draft.genderOther.trim();
    return draft.gender;
  }
  function resolvedResponseLength() {
    if (draft.responseLength === "__other__") return draft.responseLengthOther.trim();
    return draft.responseLength;
  }
  function resolvedTone() {
    if (draft.tone === "__other__") return draft.toneOther.trim();
    return draft.tone;
  }
  function resolvedFocusAreas() {
    const custom = draft.focusOtherText.trim();
    return custom ? [...draft.focusAreas, custom] : draft.focusAreas;
  }

  function isStepValid() {
    if (step === 1) return draft.name.trim().length > 0;
    if (step === 2) return resolvedGender().length > 0;
    if (step === 3) return resolvedResponseLength().length > 0;
    if (step === 4) return resolvedTone().length > 0;
    if (step === 5) return resolvedFocusAreas().length > 0;
    return true;
  }

  function next() {
    setStep((s) => s + 1);
  }
  function back() {
    setStep((s) => s - 1);
  }
  function jumpTo(s: number) {
    setStep(s);
  }

  async function handleDone() {
    setSaving(true);
    const profile: UserProfile = {
      version: 1,
      completedAt: new Date().toISOString(),
      name: draft.name.trim(),
      birthday: draft.birthday || undefined,
      gender: resolvedGender(),
      responseLength: resolvedResponseLength(),
      tone: resolvedTone(),
      toneLevel: draft.toneLevel,
      focusAreas: resolvedFocusAreas(),
      proactiveness: draft.proactiveness,
      extraContext: draft.extraContext.trim() || undefined,
    };
    try {
      await api.saveUserProfile(profile);
      onComplete?.(profile);
      navigate("/");
    } finally {
      setSaving(false);
    }
  }

  const focusOtherActive =
    draft.focusOtherText !== "" || draft.focusAreas.some((a) => !FOCUS_OPTIONS.includes(a));

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--bg)" }}
    >
      <div className="w-full max-w-3xl min-h-150 flex flex-col justify-center">
        {/* Header with back button (edit mode) */}
        {!isFirstTime && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors mb-8 cursor-pointer"
          >
            ← Back
          </button>
        )}

        {/* Card */}
        <div
          className="flex flex-1 rounded-2xl border border-[var(--border)] shadow-2xl h-full"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div className="w-1/2 flex items-center justify-center max-md:hidden">
            <AppLogo size={150} />
          </div>
          <div
            className="w-1/2 max-md:w-full max-md:rounded-2xl rounded-tr-2xl rounded-br-2xl border-l border-[var(--border)] p-8"
            style={{ background: "var(--bg-elevated)" }}
          >
            {/* ── Step 0: Welcome ─────────────────────────────────── */}
            {step === 0 && (
              <div className="text-center space-y-4">
                <div className="flex justify-center mb-2">
                  <AppLogo size={36} />
                </div>
                <h1 className="text-2xl font-semibold text-[var(--text)]">
                  Let's tailor your assistant
                </h1>
                <p className="text-[var(--text-soft)] text-sm leading-relaxed">
                  Answer a few quick questions so I can work exactly the way you prefer. Takes under
                  a minute.
                </p>
                <button
                  type="button"
                  onClick={next}
                  className="mt-4 w-full py-3 rounded-xl font-medium text-sm cursor-pointer transition-opacity hover:opacity-90"
                  style={{ background: "var(--accent)", color: "#1a1815" }}
                >
                  Get started →
                </button>
              </div>
            )}

            {/* ── Steps 1–7: Data gathering ───────────────────────── */}
            {step >= 1 && step <= TOTAL_DATA_STEPS && (
              <div className="space-y-6">
                <StepDots current={step} />

                {/* Step 1: Name + Birthday */}
                {step === 1 && (
                  <div className="space-y-5">
                    <h2 className="text-lg font-semibold text-[var(--text)]">Nice to meet you!</h2>

                    <div>
                      <FieldLabel>Your name</FieldLabel>
                      <input
                        autoFocus
                        type="text"
                        placeholder="How should I call you?"
                        value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
                      />
                    </div>

                    <div>
                      <FieldLabel optional>Birthday</FieldLabel>
                      <input
                        type="date"
                        max={TODAY}
                        value={draft.birthday}
                        onChange={(e) => setDraft((d) => ({ ...d, birthday: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] text-sm outline-none focus:border-[var(--accent)] transition-colors"
                        style={{ colorScheme: "dark" }}
                      />
                      <p className="text-xs text-[var(--text-muted)] mt-1.5">
                        Used to personalize the experience — never shared.
                      </p>
                    </div>
                  </div>
                )}

                {/* Step 2: Gender */}
                {step === 2 && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-[var(--text)]">
                      How do you identify?
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {GENDER_OPTIONS.map((opt) => (
                        <Chip
                          key={opt}
                          label={opt}
                          selected={draft.gender === opt}
                          onClick={() => setDraft((d) => ({ ...d, gender: opt, genderOther: "" }))}
                        />
                      ))}
                      <Chip
                        label="Other"
                        selected={draft.gender === "__other__"}
                        onClick={() => setDraft((d) => ({ ...d, gender: "__other__" }))}
                      />
                    </div>
                    {draft.gender === "__other__" && (
                      <input
                        autoFocus
                        type="text"
                        placeholder="Describe your identity…"
                        value={draft.genderOther}
                        onChange={(e) => setDraft((d) => ({ ...d, genderOther: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                      />
                    )}
                  </div>
                )}

                {/* Step 3: Response length */}
                {step === 3 && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-[var(--text)]">
                      How much detail do you prefer?
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {RESPONSE_LENGTH_OPTIONS.map((opt) => (
                        <Chip
                          key={opt}
                          label={opt}
                          selected={draft.responseLength === opt}
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              responseLength: opt,
                              responseLengthOther: "",
                            }))
                          }
                        />
                      ))}
                      <Chip
                        label="Other"
                        selected={draft.responseLength === "__other__"}
                        onClick={() => setDraft((d) => ({ ...d, responseLength: "__other__" }))}
                      />
                    </div>
                    {draft.responseLength === "__other__" && (
                      <input
                        autoFocus
                        type="text"
                        placeholder="Describe your preference…"
                        value={draft.responseLengthOther}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, responseLengthOther: e.target.value }))
                        }
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                      />
                    )}
                  </div>
                )}

                {/* Step 4: Tone */}
                {step === 4 && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-[var(--text)]">
                      What tone works best for you?
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {TONE_OPTIONS.map((opt) => (
                        <Chip
                          key={opt}
                          label={opt}
                          selected={draft.tone === opt}
                          onClick={() => setDraft((d) => ({ ...d, tone: opt, toneOther: "" }))}
                        />
                      ))}
                      <Chip
                        label="Other"
                        selected={draft.tone === "__other__"}
                        onClick={() => setDraft((d) => ({ ...d, tone: "__other__" }))}
                      />
                    </div>
                    {draft.tone === "__other__" && (
                      <input
                        autoFocus
                        type="text"
                        placeholder="Describe your preferred tone…"
                        value={draft.toneOther}
                        onChange={(e) => setDraft((d) => ({ ...d, toneOther: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                      />
                    )}
                    <div className="pt-2">
                      <p className="text-xs text-[var(--text-muted)] mb-3">Formality level</p>
                      <SliderField
                        value={draft.toneLevel}
                        onChange={(v) => setDraft((d) => ({ ...d, toneLevel: v }))}
                        leftLabel="Formal"
                        rightLabel="Casual"
                      />
                    </div>
                  </div>
                )}

                {/* Step 5: Focus areas */}
                {step === 5 && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-[var(--text)]">
                      What do you mainly use this for?
                    </h2>
                    <p className="text-xs text-[var(--text-muted)]">Select all that apply</p>
                    <div className="flex flex-wrap gap-2">
                      {FOCUS_OPTIONS.map((opt) => (
                        <Chip
                          key={opt}
                          label={opt}
                          selected={draft.focusAreas.includes(opt)}
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              focusAreas: d.focusAreas.includes(opt)
                                ? d.focusAreas.filter((a) => a !== opt)
                                : [...d.focusAreas, opt],
                            }))
                          }
                        />
                      ))}
                      <Chip
                        label="Other"
                        selected={focusOtherActive}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            focusOtherText: d.focusOtherText ? "" : " ",
                          }))
                        }
                      />
                    </div>
                    {focusOtherActive && (
                      <input
                        autoFocus
                        type="text"
                        placeholder="e.g. data analysis, legal research…"
                        value={draft.focusOtherText.trim()}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, focusOtherText: e.target.value }))
                        }
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                      />
                    )}
                  </div>
                )}

                {/* Step 6: Proactiveness */}
                {step === 6 && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-[var(--text)]">
                      How proactive should I be?
                    </h2>
                    <p className="text-sm text-[var(--text-soft)]">
                      {draft.proactiveness > 66
                        ? "I'll suggest next steps, flag things you might have missed, and ask follow-up questions."
                        : draft.proactiveness > 33
                          ? "I'll occasionally offer suggestions when it seems useful."
                          : "I'll stay focused and only answer exactly what you ask."}
                    </p>
                    <SliderField
                      value={draft.proactiveness}
                      onChange={(v) => setDraft((d) => ({ ...d, proactiveness: v }))}
                      leftLabel="Just answer"
                      rightLabel="Suggest & guide"
                    />
                  </div>
                )}

                {/* Step 7: Extra context (optional) */}
                {step === 7 && (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <h2 className="text-lg font-semibold text-[var(--text)]">
                        Anything else I should know?
                      </h2>
                      <span className="text-xs text-[var(--text-muted)] mt-1">Optional</span>
                    </div>
                    <p className="text-xs text-[var(--text-soft)]">
                      Your role, background, goals — anything that helps me help you better.
                    </p>
                    <textarea
                      autoFocus
                      rows={4}
                      placeholder="e.g. I'm a senior backend engineer working on a Go microservices project…"
                      value={draft.extraContext}
                      onChange={(e) => setDraft((d) => ({ ...d, extraContext: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] resize-none"
                    />
                  </div>
                )}

                {/* Navigation */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={back}
                    className="px-4 py-2 rounded-lg text-sm text-[var(--text-soft)] hover:text-[var(--text)] transition-colors cursor-pointer"
                  >
                    Back
                  </button>
                  <div className="flex-1" />
                  {step === TOTAL_DATA_STEPS && (
                    <button
                      type="button"
                      onClick={next}
                      className="px-4 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-soft)] transition-colors cursor-pointer"
                    >
                      Skip
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={next}
                    disabled={!isStepValid()}
                    className={[
                      "px-5 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer",
                      isStepValid()
                        ? "text-[#1a1815] hover:opacity-90"
                        : "opacity-30 cursor-not-allowed text-[#1a1815]",
                    ].join(" ")}
                    style={{ background: "var(--accent)" }}
                  >
                    {step === TOTAL_DATA_STEPS ? "Review →" : "Next →"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Summary ─────────────────────────────────────────── */}
            {step === SUMMARY_STEP && (
              <div className="space-y-5">
                <div className="text-center">
                  <div className="text-3xl mb-2">✓</div>
                  <h2 className="text-xl font-semibold text-[var(--text)]">
                    Here's how I'll work with you
                  </h2>
                </div>

                <ul className="space-y-2">
                  {buildSummaryLines({
                    name: draft.name.trim(),
                    gender: resolvedGender(),
                    responseLength: resolvedResponseLength(),
                    tone: resolvedTone(),
                    toneLevel: draft.toneLevel,
                    focusAreas: resolvedFocusAreas(),
                    proactiveness: draft.proactiveness,
                  }).map((line, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-[var(--text-soft)]">
                      <span className="text-[var(--accent)] mt-0.5">–</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                <div className="border-t border-[var(--border)] pt-4 flex flex-wrap gap-x-4 gap-y-1">
                  {[
                    { label: "Name & birthday", step: 1 },
                    { label: "Identity", step: 2 },
                    { label: "Response length", step: 3 },
                    { label: "Tone", step: 4 },
                    { label: "Focus areas", step: 5 },
                    { label: "Proactiveness", step: 6 },
                    { label: "Extra context", step: 7 },
                  ].map(({ label, step: s }) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => jumpTo(s)}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] underline underline-offset-2 transition-colors cursor-pointer"
                    >
                      Edit {label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleDone}
                  disabled={saving}
                  className="w-full py-3 rounded-xl font-medium text-sm cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "var(--accent)", color: "#1a1815" }}
                >
                  {saving ? "Saving…" : "Let's go"}
                </button>

                {isFirstTime && (
                  <p className="text-center text-xs text-[var(--text-muted)]">
                    You can update these preferences anytime in Settings.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
