import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Check,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  BlockKind,
  JobKind,
  MemoryBlock,
  MemoryEpisode,
  MemoryJob,
  MemoryNote,
  NoteKind,
} from "../lib/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<NoteKind, string> = {
  fact: "Fact",
  preference: "Preference",
  goal: "Goal",
  constraint: "Constraint",
  skill: "Skill",
  relationship: "Relationship",
  event: "Event",
};

const KIND_COLORS: Record<NoteKind, string> = {
  fact: "bg-blue-500/15 text-blue-300",
  preference: "bg-purple-500/15 text-purple-300",
  goal: "bg-emerald-500/15 text-emerald-300",
  constraint: "bg-red-500/15 text-red-300",
  skill: "bg-amber-500/15 text-amber-300",
  relationship: "bg-pink-500/15 text-pink-300",
  event: "bg-gray-500/15 text-gray-300",
};

const BLOCK_LABELS: Record<BlockKind, string> = {
  projects: "Projects",
  preferences: "Preferences",
  constraints: "Constraints",
  active_tasks: "Active tasks",
};

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  return <span className={`text-xs tabular-nums ${color}`}>{pct}%</span>;
}

// ─── Note card ───────────────────────────────────────────────────────────────

function NoteCard({
  note,
  onPin,
  onEdit,
  onDelete,
}: {
  note: MemoryNote;
  onPin(id: string, pinned: boolean): void;
  onEdit(id: string, summary: string): void;
  onDelete(id: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(note.summary);

  function submitEdit() {
    if (editValue.trim() && editValue.trim() !== note.summary) {
      onEdit(note.id, editValue.trim());
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditValue(note.summary);
    setEditing(false);
  }

  return (
    <div
      className={[
        "group relative rounded-xl border p-4 transition-colors",
        note.pinnedByUser
          ? "border-[var(--accent)]/40 bg-[var(--accent)]/5"
          : "border-[var(--border)] bg-[var(--bg-elevated)]",
      ].join(" ")}
    >
      {/* Top row: kind badge + scope + confidence + actions */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${KIND_COLORS[note.kind]}`}>
          {KIND_LABELS[note.kind]}
        </span>
        {note.scope === "global" && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-soft)] text-[var(--text-muted)]">
            global
          </span>
        )}
        <ConfidenceBadge value={note.confidence} />

        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onPin(note.id, !note.pinnedByUser)}
            title={note.pinnedByUser ? "Unpin" : "Pin"}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            {note.pinnedByUser ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(note.id)}
            title="Delete"
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Summary */}
      {editing ? (
        <div className="flex items-start gap-2">
          <textarea
            autoFocus
            rows={2}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitEdit();
              }
              if (e.key === "Escape") cancelEdit();
            }}
            className="flex-1 px-2 py-1 rounded-lg border border-[var(--accent)] bg-[var(--bg-soft)] text-[var(--text)] text-sm outline-none resize-none"
          />
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={submitEdit}
              className="p-1 rounded-lg bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30 transition-colors cursor-pointer"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="p-1 rounded-lg hover:bg-[var(--bg-soft)] text-[var(--text-muted)] transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--text-soft)] leading-relaxed">{note.summary}</p>
      )}
    </div>
  );
}

// ─── Block card ──────────────────────────────────────────────────────────────

function BlockCard({ block }: { block: MemoryBlock }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
          {BLOCK_LABELS[block.kind]}
        </span>
      </div>
      <p className="text-sm text-[var(--text-soft)] whitespace-pre-wrap leading-relaxed">
        {block.content}
      </p>
    </div>
  );
}

// ─── Episode card ─────────────────────────────────────────────────────────────

function ImportanceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-[var(--text-muted)]";
  return <span className={`text-xs tabular-nums ${color}`}>{pct}%</span>;
}

function EpisodeCard({ episode }: { episode: MemoryEpisode }) {
  const entities: string[] = (() => {
    try {
      return JSON.parse(episode.entities);
    } catch {
      return [];
    }
  })();
  const topics: string[] = (() => {
    try {
      return JSON.parse(episode.topics);
    } catch {
      return [];
    }
  })();
  const date = new Date(episode.created_at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--text-muted)]">{date}</span>
        <span
          className="text-xs font-mono text-[var(--text-muted)] truncate max-w-[140px]"
          title={episode.chat_id}
        >
          chat {episode.chat_id.slice(0, 8)}…
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-[var(--text-muted)]">
          importance <ImportanceBadge value={episode.importance} />
        </span>
        {episode.processed_for_notes === 1 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
            notes extracted
          </span>
        )}
      </div>
      <p className="text-sm text-[var(--text-soft)] leading-relaxed">{episode.summary}</p>
      {episode.outcome && (
        <p className="text-xs text-[var(--text-muted)] italic">{episode.outcome}</p>
      )}
      {(topics.length > 0 || entities.length > 0) && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {topics.map((t) => (
            <span
              key={t}
              className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-soft)] text-[var(--text-muted)]"
            >
              {t}
            </span>
          ))}
          {entities.map((e) => (
            <span key={e} className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300">
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Job run card ─────────────────────────────────────────────────────────────

const JOB_KIND_LABELS: Record<JobKind, string> = {
  build_episodes: "Build episodes",
  extract_notes: "Extract notes",
  rebuild_blocks: "Rebuild blocks",
  decay_salience: "Decay salience",
};

function JobRunCard({ job }: { job: MemoryJob }) {
  const statusIcon = {
    done: <CheckCircle2 size={14} className="text-emerald-400" />,
    failed: <XCircle size={14} className="text-red-400" />,
    pending: <Clock size={14} className="text-[var(--text-muted)]" />,
    running: <Loader2 size={14} className="text-amber-400 animate-spin" />,
  }[job.status];

  const statusColor = {
    done: "text-emerald-400",
    failed: "text-red-400",
    pending: "text-[var(--text-muted)]",
    running: "text-amber-400",
  }[job.status];

  const date = new Date(job.created_at);
  const formatted = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 flex items-start gap-3">
      <div className="mt-0.5">{statusIcon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-[var(--text)]">
            {JOB_KIND_LABELS[job.kind]}
          </span>
          <span className={`text-xs font-medium capitalize ${statusColor}`}>{job.status}</span>
          {job.attempts > 1 && (
            <span className="text-xs text-[var(--text-muted)]">{job.attempts} attempts</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="text-xs text-[var(--text-muted)]">{formatted}</span>
          {job.chat_id && (
            <span
              className="text-xs text-[var(--text-muted)] font-mono truncate max-w-[180px]"
              title={job.chat_id}
            >
              chat {job.chat_id.slice(0, 8)}…
            </span>
          )}
        </div>
        {job.error && (
          <p className="mt-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg px-2 py-1 break-words">
            {job.error}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

type Tab = "notes" | "blocks" | "episodes" | "jobs";

export function MemoryPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("notes");
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [blocks, setBlocks] = useState<MemoryBlock[]>([]);
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([]);
  const [jobs, setJobs] = useState<MemoryJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<NoteKind | "all">("all");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.listMemoryNotes(),
      api.listMemoryBlocks(),
      api.listMemoryEpisodes(),
      api.listMemoryJobs(),
    ])
      .then(([n, b, e, j]) => {
        setNotes(n);
        setBlocks(b);
        setEpisodes(e);
        setJobs(j);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handlePin(id: string, pinned: boolean) {
    const updated = await api.patchMemoryNote(id, { pinnedByUser: pinned ? 1 : 0 });
    setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
  }

  async function handleEdit(id: string, summary: string) {
    const updated = await api.patchMemoryNote(id, { summary });
    setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
  }

  async function handleDelete(id: string) {
    await api.deleteMemoryNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  const activeNotes = notes.filter((n) => n.status === "active");
  const filteredNotes =
    filter === "all" ? activeNotes : activeNotes.filter((n) => n.kind === filter);

  const allKinds = [...new Set(activeNotes.map((n) => n.kind))];

  const pinnedNotes = filteredNotes.filter((n) => n.pinnedByUser);
  const unpinnedNotes = filteredNotes.filter((n) => !n.pinnedByUser);

  return (
    <div
      className="min-h-screen flex flex-col h-screen max-h-screen overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      {/* Header */}
      <div
        className="border-b border-[var(--border)] px-6 py-4 flex items-center gap-4"
        style={{ background: "var(--bg-elevated)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
        >
          ←
        </button>
        <h1 className="text-base font-semibold text-[var(--text)]">Memory</h1>

        {/* Tabs */}
        <div
          className="ml-auto flex items-center gap-1 rounded-lg p-1"
          style={{ background: "var(--bg-soft)" }}
        >
          {(["notes", "blocks", "episodes", "jobs"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer capitalize",
                tab === t
                  ? "text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-soft)]",
              ].join(" ")}
              style={tab === t ? { background: "var(--bg-elevated)" } : {}}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 w-full  h-full max-h-full overflow-y-auto">
        <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <span className="text-sm text-[var(--text-muted)]">Loading…</span>
            </div>
          ) : tab === "episodes" ? (
            <>
              <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
                {episodes.length} episode{episodes.length !== 1 ? "s" : ""} (latest 20)
              </h2>
              {episodes.length === 0 ? (
                <div className="text-center py-16 text-[var(--text-muted)] text-sm">
                  No episodes yet. They're built automatically after enough messages accumulate.
                </div>
              ) : (
                <div className="space-y-3">
                  {episodes.map((ep) => (
                    <EpisodeCard key={ep.id} episode={ep} />
                  ))}
                </div>
              )}
            </>
          ) : tab === "jobs" ? (
            <>
              <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
                Latest 10 job runs
              </h2>
              {jobs.length === 0 ? (
                <div className="text-center py-16 text-[var(--text-muted)] text-sm">
                  No jobs have run yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <JobRunCard key={job.id} job={job} />
                  ))}
                </div>
              )}
            </>
          ) : tab === "notes" ? (
            <>
              {/* Kind filter pills */}
              {allKinds.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className={[
                      "px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer",
                      filter === "all"
                        ? "text-[#1a1815]"
                        : "bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-[var(--text)]",
                    ].join(" ")}
                    style={filter === "all" ? { background: "var(--accent)" } : {}}
                  >
                    All ({activeNotes.length})
                  </button>
                  {allKinds.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFilter(k)}
                      className={[
                        "px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer",
                        filter === k
                          ? "text-[#1a1815]"
                          : "bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-[var(--text)]",
                      ].join(" ")}
                      style={filter === k ? { background: "var(--accent)" } : {}}
                    >
                      {KIND_LABELS[k]} ({activeNotes.filter((n) => n.kind === k).length})
                    </button>
                  ))}
                </div>
              )}

              {filteredNotes.length === 0 ? (
                <div className="text-center py-16 text-[var(--text-muted)] text-sm">
                  No memory notes yet. They'll appear here as I learn more about you.
                </div>
              ) : (
                <div className="space-y-6">
                  {pinnedNotes.length > 0 && (
                    <section>
                      <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">
                        Pinned
                      </h2>
                      <div className="space-y-2">
                        {pinnedNotes.map((note) => (
                          <NoteCard
                            key={note.id}
                            note={note}
                            onPin={handlePin}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {unpinnedNotes.length > 0 && (
                    <section>
                      {pinnedNotes.length > 0 && (
                        <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">
                          All notes
                        </h2>
                      )}
                      <div className="space-y-2">
                        {unpinnedNotes.map((note) => (
                          <NoteCard
                            key={note.id}
                            note={note}
                            onPin={handlePin}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Blocks tab */
            <>
              {blocks.length === 0 ? (
                <div className="text-center py-16 text-[var(--text-muted)] text-sm">
                  No memory blocks yet. They're built automatically from your notes.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {blocks.map((block) => (
                    <BlockCard key={block.id} block={block} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
