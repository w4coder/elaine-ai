import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Trash2,
  ExternalLink,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { INTERVAL_PRESETS } from "../lib/types";
import type { ScheduledJob } from "../lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MS_TO_VALUE: Record<number, string> = {
  [30 * 60 * 1000]: "30m",
  [60 * 60 * 1000]: "1h",
  [6 * 60 * 60 * 1000]: "6h",
  [12 * 60 * 60 * 1000]: "12h",
  [24 * 60 * 60 * 1000]: "1d",
  [7 * 24 * 60 * 60 * 1000]: "1w",
};

const INTERVAL_LABELS: Record<number, string> = {
  [30 * 60 * 1000]: "Every 30 min",
  [60 * 60 * 1000]: "Every hour",
  [6 * 60 * 60 * 1000]: "Every 6 hours",
  [12 * 60 * 60 * 1000]: "Every 12 hours",
  [24 * 60 * 60 * 1000]: "Daily",
  [7 * 24 * 60 * 60 * 1000]: "Weekly",
};

const DAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];

function intervalLabel(ms: number): string {
  return INTERVAL_LABELS[ms] ?? `Every ${Math.round(ms / 60000)} min`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOverdue(nextRunAt: string, enabled: boolean): boolean {
  return enabled && new Date(nextRunAt).getTime() < Date.now() - 60_000;
}

// ─── Inline timing editor ────────────────────────────────────────────────────

function TimingEditor({
  job,
  onSave,
  onCancel,
}: {
  job: ScheduledJob;
  onSave(intervalValue: string, runAtTime?: string, runAtDay?: number): Promise<void>;
  onCancel(): void;
}) {
  const [selectedInterval, setSelectedInterval] = useState(MS_TO_VALUE[job.intervalMs] ?? "1d");
  const [runAtTime, setRunAtTime] = useState("09:00");
  const [runAtDay, setRunAtDay] = useState(1);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(
        selectedInterval,
        selectedInterval === "1d" || selectedInterval === "1w" ? runAtTime : undefined,
        selectedInterval === "1w" ? runAtDay : undefined
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/8 flex flex-col gap-3">
      {/* Frequency */}
      <div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mb-2">
          <Clock size={11} />
          Frequency
        </div>
        <div className="flex flex-wrap gap-1.5">
          {INTERVAL_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                selectedInterval === p.value
                  ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                  : "border-white/10 text-[var(--text-muted)] hover:border-white/25 hover:text-white"
              }`}
              onClick={() => setSelectedInterval(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 flex-wrap">
        {/* Weekly: day picker */}
        {selectedInterval === "1w" && (
          <div>
            <div className="text-xs text-[var(--text-muted)] mb-2">Day</div>
            <div className="flex gap-1">
              {DAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                    runAtDay === d.value
                      ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                      : "border-white/10 text-[var(--text-muted)] hover:border-white/25 hover:text-white"
                  }`}
                  onClick={() => setRunAtDay(d.value)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Daily / weekly: time picker */}
        {(selectedInterval === "1d" || selectedInterval === "1w") && (
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mb-2">
              <Clock size={11} />
              {selectedInterval === "1w" ? "Time" : "Time of day"}
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
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          onClick={() => void handleSave()}
        >
          <Check size={12} />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-white/10 text-[var(--text-muted)] hover:text-white transition-colors"
          onClick={onCancel}
        >
          <X size={12} />
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Job card ─────────────────────────────────────────────────────────────────

function JobCard({
  job,
  onToggle,
  onEdit,
  onDelete,
  onOpen,
}: {
  job: ScheduledJob;
  onToggle(id: string, enabled: boolean): void;
  onEdit(id: string, intervalValue: string, runAtTime?: string, runAtDay?: number): Promise<void>;
  onDelete(id: string): void;
  onOpen(conversationId: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const overdue = isOverdue(job.nextRunAt, job.enabled);

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-3 transition-opacity ${
        job.enabled ? "border-white/10 bg-white/3" : "border-white/5 bg-white/1 opacity-60"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                job.enabled
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-white/5 text-[var(--text-muted)] border-white/10"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${job.enabled ? "bg-emerald-400" : "bg-white/30"}`}
              />
              {job.enabled ? "Active" : "Paused"}
            </span>
            <span className="text-xs text-[var(--text-muted)] bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
              {intervalLabel(job.intervalMs)}
            </span>
          </div>
          <h3 className="text-sm font-medium text-[var(--text)] truncate">{job.title}</h3>
          <p className="text-xs text-[var(--text-soft)] line-clamp-2 leading-relaxed">
            {job.description}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={job.enabled ? "Pause" : "Resume"}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => onToggle(job.id, !job.enabled)}
          >
            {job.enabled ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            type="button"
            title="Edit timing"
            className={`p-1.5 rounded-lg transition-colors ${editing ? "text-[var(--accent)] bg-[var(--accent)]/10" : "text-[var(--text-muted)] hover:text-white hover:bg-white/10"}`}
            onClick={() => setEditing((e) => !e)}
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            title={job.lastRunConversationId ? "Open last run" : "Open source conversation"}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => onOpen(job.lastRunConversationId ?? job.conversationId)}
          >
            <ExternalLink size={15} />
          </button>
          <button
            type="button"
            title="Delete"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
            onClick={() => onDelete(job.id)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 pt-1 border-t border-white/5 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <Clock size={11} />
          <span>
            Next:{" "}
            <span className={overdue ? "text-amber-400" : "text-[var(--text-soft)]"}>
              {formatDate(job.nextRunAt)}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <Clock size={11} />
          Last: <span className="text-[var(--text-soft)]">{formatDate(job.lastRunAt)}</span>
        </span>
        <span className="flex items-center gap-1.5 ml-auto">
          <MessageSquare size={11} />
          {job.runCount}
          {job.maxRuns ? ` / ${job.maxRuns}` : ""} runs
        </span>
      </div>

      {/* Inline timing editor */}
      {editing && (
        <TimingEditor
          job={job}
          onSave={async (intervalValue, runAtTime, runAtDay) => {
            await onEdit(job.id, intervalValue, runAtTime, runAtDay);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SchedulesPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listScheduledJobs()
      .then(setJobs)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load schedules."))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(id: string, enabled: boolean) {
    try {
      const updated = await api.updateScheduledJob(id, { enabled });
      setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
    } catch {
      setError("Failed to update schedule.");
    }
  }

  async function handleEdit(
    id: string,
    intervalValue: string,
    runAtTime?: string,
    runAtDay?: number
  ) {
    const updated = await api.updateScheduledJob(id, { intervalValue, runAtTime, runAtDay });
    setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
  }

  async function handleDelete(id: string) {
    const job = jobs.find((j) => j.id === id);
    if (!window.confirm(`Delete "${job?.title ?? "this schedule"}"? This cannot be undone.`))
      return;
    try {
      await api.deleteScheduledJob(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch {
      setError("Failed to delete schedule.");
    }
  }

  const active = jobs.filter((j) => j.enabled);
  const paused = jobs.filter((j) => !j.enabled);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col">
      {/* Topbar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/8">
        <button
          type="button"
          className="flex items-center gap-2 text-sm text-[var(--text-soft)] hover:text-white transition-colors"
          onClick={() => navigate("/")}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="flex items-center gap-2 ml-2">
          <Calendar size={18} className="text-[var(--accent)]" />
          <h1 className="text-base font-semibold">Scheduled Tasks</h1>
        </div>
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          {jobs.length} task{jobs.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
        {loading && <p className="text-sm text-[var(--text-muted)] text-center mt-12">Loading…</p>}

        {error && (
          <div className="flex items-center justify-between text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 mt-20 text-center">
            <Calendar size={40} className="text-[var(--text-muted)] opacity-40" />
            <p className="text-sm text-[var(--text-muted)]">No scheduled tasks yet.</p>
            <p className="text-xs text-[var(--text-muted)] opacity-70">
              Start a Schedule conversation to create one.
            </p>
            <button
              type="button"
              className="mt-2 text-sm px-4 py-2 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              onClick={() => navigate("/")}
            >
              New schedule
            </button>
          </div>
        )}

        {active.length > 0 && (
          <section className="mb-6">
            <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">
              Active — {active.length}
            </h2>
            <div className="flex flex-col gap-3">
              {active.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onToggle={(id, enabled) => void handleToggle(id, enabled)}
                  onEdit={(id, iv, rt, rd) => handleEdit(id, iv, rt, rd)}
                  onDelete={(id) => void handleDelete(id)}
                  onOpen={(cid) => navigate(`/c/${cid}`)}
                />
              ))}
            </div>
          </section>
        )}

        {paused.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">
              Paused — {paused.length}
            </h2>
            <div className="flex flex-col gap-3">
              {paused.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onToggle={(id, enabled) => void handleToggle(id, enabled)}
                  onEdit={(id, iv, rt, rd) => handleEdit(id, iv, rt, rd)}
                  onDelete={(id) => void handleDelete(id)}
                  onOpen={(cid) => navigate(`/c/${cid}`)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
