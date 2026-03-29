# Memory System

Elaine's memory system is a hybrid of three paradigms:

- **A-MEM** (Agentic Memory) — autonomous background workers that continuously process conversation history into structured, queryable memory without requiring the user to ask
- **Zettelkasten** — each piece of knowledge lives as an atomic, typed, fingerprinted note with explicit links to its source episodes, rather than a single monolithic context blob
- **Letta / MemGPT** — structured memory blocks injected into the system prompt as named sections, giving the model an always-up-to-date view of the user's context without burning the full conversation window

---

## Pipeline overview

```
Conversations
     │
     ▼  (on every new message)
[Episode Builder]  ── batch 6–20 messages → LLM → EpisodeRow
     │                  (summary, entities, topics, outcome, importance)
     ▼  (after each episode batch)
[Note Extractor]   ── episodes + existing notes → LLM → NoteActions
     │                  (create / update / supersede / skip)
     ▼  (after note changes)
[Block Rebuilder]  ── active notes by kind → salience-sorted text blocks
     │
     ▼  (daily, background)
[Salience Decay]   ── multiply salience × decay rate; archive dead chat notes
```

Each stage is an async background job persisted in `mem_jobs`. Jobs are retried on failure and are idempotent — restarting the server replays any incomplete work.

---

## Stage 1 — Episode building

**Trigger:** ≥ 6 unprocessed messages in a chat, or any new message after a 5-minute stale window.

**What it does:** Chunks raw messages (up to 20 per chunk) and sends them to the LLM with a structured extraction prompt. The model returns:

```json
{
  "summary": "User asked for a React performance audit, assistant identified 3 re-render hotspots",
  "entities": ["React", "useCallback", "ProfilePage"],
  "topics": ["performance", "memoization"],
  "outcome": "identified issues, fix deferred to next session",
  "importance": 0.75
}
```

Episodes are stored as `EpisodeRow` records and marked `processed_for_notes = 0` until the note extractor runs.

A **chat lock** (UUID token + expiry timestamp) prevents two jobs from processing the same chat concurrently.

---

## Stage 2 — Note extraction

**Trigger:** After each episode batch completes.

**What it does:** Takes all unprocessed episodes for a chat plus a summary of the current active notes, and asks the LLM to decide what to remember. The model chooses from four actions per insight:

| Action      | When to use                                       |
| ----------- | ------------------------------------------------- |
| `create`    | New information not covered by any existing note  |
| `update`    | Existing note is still valid but needs refinement |
| `supersede` | Old note is now wrong or outdated — replace it    |
| `skip`      | Nothing worth persisting                          |

**Deduplication:** Every note gets a deterministic **fingerprint** (SHA-256 of `kind + summary + sorted entities`). A `create` action for an already-fingerprinted note bumps its salience instead of creating a duplicate.

**Note anatomy:**

| Field                | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `kind`               | `preference` · `project` · `fact` · `constraint` · `task`    |
| `scope`              | `chat` (this conversation only) or `global` (user-wide)      |
| `summary`            | Concise natural-language statement                           |
| `confidence`         | 0–1, how certain this is accurate                            |
| `stability`          | 0–1, how likely it is to remain true (tasks=low, facts=high) |
| `salience`           | 0–1, current importance weight, decays over time             |
| `status`             | `active` · `superseded` · `archived`                         |
| `pinned_by_user`     | Never touched by any automated process                       |
| `edited_by_user`     | Prevents automated update/supersede actions                  |
| `source_episode_ids` | Back-link to the episodes that produced this note            |

**Promotion — chat → global:** After extraction, any chat-scoped note with `stability ≥ 0.8`, `confidence ≥ 0.85`, and presence in ≥ 2 distinct chats is automatically promoted to global scope.

---

## Stage 3 — Block rebuilding

**Trigger:** After note extraction completes.

**What it does:** Collapses all active notes into four named **memory blocks** — the Letta/MemGPT-style structured context that gets injected into the system prompt:

| Block          | Note kind    |
| -------------- | ------------ |
| `Projects`     | `project`    |
| `Preferences`  | `preference` |
| `Constraints`  | `constraint` |
| `Active Tasks` | `task`       |

Each block is a bullet list of note summaries, sorted highest salience first. Global notes and chat-scoped notes are merged, with deduplication by ID.

Example injected context:

```
### User Memory
**Projects**
• Building Elaine — local-first AI assistant in React + Fastify
• Migrating auth middleware to comply with new session token requirements

**Preferences**
• Prefers concise responses without trailing summaries
• Uses Tailwind CSS utility classes, not custom CSS

**Constraints**
• Merge freeze until 2026-03-05 for mobile release cut

**Active Tasks**
• Add schedule timing editor to SchedulesPage
```

---

## Stage 4 — Salience decay

**Schedule:** Daily background job.

**Rates:**

| Scope  | Decay rate per cycle | Archive threshold            |
| ------ | -------------------- | ---------------------------- |
| Global | × 0.98               | never auto-archived          |
| Chat   | × 0.95               | archived when salience < 0.1 |

Pinned notes are never modified by decay. Archived notes are excluded from retrieval and blocks but remain in the database for audit/recovery.

A note can have its salience restored if a `create` action fires on the same fingerprint (bumps by +0.1) or an `update` action fires (bumps by +0.05).

---

## Retrieval — building the context string

When a new message arrives, `memory.query()` is called before the model sees it. The retrieval layer assembles a ranked context string using three signals:

```
score = semantic × 0.5 + recency × 0.25 + salience × 0.25
```

| Signal     | Calculation                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `semantic` | Cosine similarity between the query embedding and the note embedding (0 if no embedder configured) |
| `recency`  | Exponential decay: `exp(-days_since_update / 30)`                                                  |
| `salience` | Current normalized salience value                                                                  |

The top 5 scoring notes are surfaced as a **Relevant Context** section alongside the structured blocks and the last 20 messages of the current chat.

If no embedding function is configured (the default), scoring falls back to recency + salience only. The system degrades gracefully.

---

## Storage tables

| Table               | Contents                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- |
| `mem_chat_messages` | Mirror of host messages for memory processing (deduped via `INSERT OR IGNORE`)          |
| `mem_chat_state`    | Per-chat cursor (`last_processed_message_id`), dirty flag, concurrency lock             |
| `mem_episodes`      | Episode summaries with entities, topics, importance                                     |
| `mem_memory_notes`  | Atomic Zettelkasten notes with fingerprint, salience, stability, confidence             |
| `mem_blocks`        | Rebuilt context blocks ready to inject into prompts                                     |
| `mem_jobs`          | Background job queue (build_episodes · extract_notes · rebuild_blocks · decay_salience) |

---

## In-conversation access — `memory_search` skill

The agent can search memory at any time during a task using the `memory_search` skill. It returns the top matching notes with `kind`, `summary`, `confidence`, `scope`, and `entities` — useful for cross-referencing past decisions without having to ask the user again.

---

## Configuration

The module is initialized in `server/src/index.ts` with:

- `llm` — the host's `completeChat` function (no extra model needed)
- `embed` — optional embedding function; pass `null` to disable semantic scoring
- `adapter` — wired to the host's SQLite message store
- `options.jobIntervalMs` — how often the job runner polls (default: 10 s)
- `options.decayIntervalMs` — daily decay scheduling

All processing is local. No external services are required.
