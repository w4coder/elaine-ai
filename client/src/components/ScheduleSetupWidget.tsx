import { useState } from "react";
import { Clock, Zap } from "lucide-react";
import { api } from "../lib/api";
import { INTERVAL_PRESETS } from "../lib/types";
import type { ScheduledJob } from "../lib/types";

const DAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];

interface Props {
  conversationId: string;
  profileId: string;
  model: string;
  title: string;
  description: string;
  prompt: string;
  onCreated(job: ScheduledJob): void;
  onDismiss(): void;
}

export function ScheduleSetupWidget({
  conversationId,
  profileId,
  model,
  title: initialTitle,
  description,
  prompt,
  onCreated,
  onDismiss,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [selectedInterval, setSelectedInterval] = useState<string>("1d");
  const [runAtTime, setRunAtTime] = useState<string>("09:00");
  const [runAtDay, setRunAtDay] = useState<number>(1); // Monday
  const [maxRuns, setMaxRuns] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const job = await api.createScheduledJob({
        conversationId,
        title: title.trim(),
        description,
        userPrompt: prompt,
        profileId,
        model,
        intervalValue: selectedInterval,
        runAtTime: selectedInterval === "1d" || selectedInterval === "1w" ? runAtTime : undefined,
        runAtDay: selectedInterval === "1w" ? runAtDay : undefined,
        enabled: true,
        maxRuns: maxRuns.trim() ? parseInt(maxRuns, 10) : null,
      });
      onCreated(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ask-user-widget">
      {/* Header */}
      <div className="ask-user-widget__header">
        <div>
          <div className="ask-user-widget__eyebrow">📅 Schedule ready</div>
          <div className="ask-user-widget__title">{title}</div>
        </div>
        <button
          type="button"
          className="ask-user-widget__dismiss"
          onClick={onDismiss}
          title="Dismiss"
        >
          ×
        </button>
      </div>

      {/* Description */}
      <p style={{ fontSize: 13, color: "var(--text-soft)", margin: 0, lineHeight: 1.5 }}>
        {description}
      </p>

      {/* Title edit */}
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Task name</div>
        <input
          className="ask-user-widget__other-input"
          style={{ width: "100%" }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Schedule title"
        />
      </div>

      <div className="flex gap-4">
        {/* Interval picker */}
        <div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Clock size={11} />
            Frequency
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {INTERVAL_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={
                  selectedInterval === preset.value
                    ? "ask-user-widget__action-btn ask-user-widget__action-btn--next"
                    : "ask-user-widget__back-btn"
                }
                style={{ padding: "4px 12px", fontSize: 12 }}
                onClick={() => setSelectedInterval(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Weekly: day-of-week picker + time */}
        {selectedInterval === "1w" && (
          <div className="flex flex-col gap-2">
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Day</div>
              <div style={{ display: "flex", gap: 4 }}>
                {DAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    className={
                      runAtDay === day.value
                        ? "ask-user-widget__action-btn ask-user-widget__action-btn--next"
                        : "ask-user-widget__back-btn"
                    }
                    style={{ padding: "4px 8px", fontSize: 12 }}
                    onClick={() => setRunAtDay(day.value)}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Clock size={11} />
                Time
              </div>
              <input
                type="time"
                className="ask-user-widget__other-input"
                style={{ width: 110 }}
                value={runAtTime}
                onChange={(e) => setRunAtTime(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Daily: time of day only */}
        {selectedInterval === "1d" && (
          <div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginBottom: 4,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Clock size={11} />
              Time of day
            </div>
            <input
              type="time"
              className="ask-user-widget__other-input"
              style={{ width: 110 }}
              value={runAtTime}
              onChange={(e) => setRunAtTime(e.target.value)}
            />
          </div>
        )}

        {/* Max runs */}
        <div className="w-1/2">
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            Max runs <span style={{ opacity: 0.6 }}>(leave empty for unlimited)</span>
          </div>
          <input
            type="number"
            min="1"
            className="ask-user-widget__other-input"
            style={{ width: 80 }}
            value={maxRuns}
            onChange={(e) => setMaxRuns(e.target.value)}
            placeholder="∞"
          />
        </div>
      </div>

      {error && <p className="ask-user-widget__err">{error}</p>}

      {/* Footer */}
      <div className="ask-user-widget__footer">
        <button type="button" className="ask-user-widget__back-btn" onClick={onDismiss}>
          Dismiss
        </button>
        <button
          type="button"
          className={`ask-user-widget__action-btn${!saving ? " ask-user-widget__action-btn--submit" : ""}`}
          disabled={saving}
          onClick={() => void handleCreate()}
        >
          <Zap size={12} style={{ display: "inline", marginRight: 4 }} />
          {saving ? "Creating…" : "Create Schedule"}
        </button>
      </div>
    </div>
  );
}
