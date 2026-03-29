# Architecture

## Overview

Elaine is a local web application with two runtime pieces:

- `client`: React SPA served by Vite in development and by Fastify in production
- `server`: Fastify API that owns persistence, provider access, and streaming chat orchestration

---

## Data flow — standard chat

1. User composes a message in the React UI.
2. Client posts to `POST /api/chat`.
3. Server resolves the active provider profile and conversation settings.
4. Server persists the user message in SQLite.
5. Provider adapter streams the response back through SSE.
6. Client renders partial output in real time.
7. Server finalizes the assistant message and schedules async title generation.
8. Title worker generates a short conversation name using the configured title model.

---

## Agent loop

When the conversation has tools attached, the response path goes through `agentLoop.ts` instead of a single provider call.

```
runAgentStream()
  └─ loop (up to MAX_ITERATIONS)
       ├─ adapter.streamChat() → stream chunks
       ├─ if toolCalls in response → execute skills
       │    ├─ internal tools (ask_user, schedule_setup, task_done, …) → yield special chunk, exit
       │    └─ external tools (file_read, web_fetch, shell_exec, …) → append tool result, continue
       └─ if no tool calls → yield content, exit
```

### Agent modes and iteration caps

| Mode        | Cap | Used for                                            |
| ----------- | --- | --------------------------------------------------- |
| `chat`      | 5   | Normal conversations with tools enabled             |
| `task`      | 30  | Explicit task mode — deep research, multi-step work |
| `scheduled` | 50  | Autonomous scheduled runs — no user present         |

The mode is passed from the route handler based on `agentMode` in the chat payload.

---

## Skills system

Skills are plain JavaScript modules in `server/src/skills/`. Each exports:

```js
export default {
  name: "skill_name",
  description: "...",     // shown to the model as the tool description
  parameters: { ... },    // JSON Schema
  execute(input) { ... }, // synchronous or async, returns any value
}
```

### Skill categories

**Control flow** — handled internally by the agent loop; cause early exit:

- `ask_user` — request clarification from the user; yields `{ questions }` chunk
- `schedule_setup` — finalize schedule creation; yields `{ scheduleReady }` chunk
- `task_done` — signal task completion; stops iteration

**Reasoning:**

- `think` — structured internal scratchpad step, not shown as a tool call

**Filesystem:**

- `file_read`, `file_write`, `file_search`

**System:**

- `shell_exec` — run shell commands in the workspace

**Web:**

- `web_fetch` — fetch and parse a URL using Playwright + Readability

**Memory:**

- `memory_search` — semantic search over user memory notes

**Communication:**

- `notify_user`, `send_message`

**Scheduling:**

- `schedule_setup` — called by the AI to create a scheduled task from a schedule-type conversation
- `schedule_task` — programmatic task scheduling

**Visualization:**

- `visualize__show_widget` — render an interactive widget inline in chat
- `visualize__read_me` — read current widget state

---

## Memory system

See **[MEMORY.md](MEMORY.md)** for the full design. Summary:

- Background pipeline: **Episodes → Notes → Blocks → Salience decay**
- Atomic Zettelkasten notes (fingerprinted, typed, scoped) inspired by A-MEM
- MemGPT-style named memory blocks (`Projects`, `Preferences`, `Constraints`, `Active Tasks`) injected into every system prompt
- Retrieval scoring: `semantic × 0.5 + recency × 0.25 + salience × 0.25`
- Chat-scoped notes auto-promote to global scope when high-stability observations appear across ≥ 2 chats
- All processing is local; embedding is optional

---

## Persistence model

SQLite via `better-sqlite3`. All migrations run on startup via `database.ts`.

| Table              | Contents                                                              |
| ------------------ | --------------------------------------------------------------------- |
| `settings`         | Serialized app config and provider profiles                           |
| `conversations`    | Metadata, model, system prompt, workspace path, title state, type     |
| `messages`         | Full ordered transcript; roles: `user`, `assistant`, `tool`, `system` |
| `user_models`      | Per-profile pinned models                                             |
| `scheduled_jobs`   | Schedule config, interval, next/last run timestamps, run count        |
| `mem_memory_notes` | User memory notes                                                     |
| `mem_episodes`     | Memory episodes                                                       |
| `mem_blocks`       | Memory blocks                                                         |

### Conversation types

| Type            | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `chat`          | Standard conversation                                                 |
| `schedule`      | Schedule-setup conversation; triggers `schedule_setup` tool injection |
| `scheduled_run` | Auto-created at each scheduled job execution                          |

### Title sources

| Source        | Behaviour                                                      |
| ------------- | -------------------------------------------------------------- |
| `placeholder` | AI has not yet generated a title                               |
| `pending`     | Title generation enqueued                                      |
| `generated`   | AI-generated title                                             |
| `manual`      | User-set or pre-set title — never overwritten by title service |

---

## Scheduled job runner

`ScheduledJobRunner` polls every 60 seconds via `setInterval`. At each tick:

1. Query `scheduled_jobs` for rows where `next_run_at <= now` and `enabled = true`.
2. For each due job, call `generateAssistantReply` with:
   - No `conversationId` — creates a fresh conversation each run.
   - `conversationType: "scheduled_run"`.
   - Title: `YYYY-MM-DD — <job title>` with `titleSource: "manual"` (never AI-generated).
   - `agentMode: "scheduled"` (50-iteration cap).
   - All task tools via `getToolsForIntent("task")`.
   - `SCHEDULED_RUN_SYSTEM_PROMPT` — instructs the agent to work autonomously and always call `task_done`.
3. Stream and consume the full response.
4. Update `run_count`, `last_run_at`, `last_run_conversation_id`, `next_run_at`.
5. If `max_runs` is reached, set `enabled = false`.

---

## Provider abstraction

`server/src/providers` exposes a small adapter interface:

```ts
interface ProviderAdapter {
  listModels(profile): Promise<string[]>;
  streamChat(input): AsyncGenerator<ProviderStreamChunk>;
  completeChat(input): Promise<string>;
}
```

Adapters:

- `openai-compatible.ts` — OpenAI API format
- `ollama.ts` — Ollama native API (also handles `think` budget for reasoning models)

`vllm` reuses the OpenAI-compatible adapter.

---

## SSE stream chunk types

The server emits typed SSE events per-connection. The client handles each:

| Event            | Payload                          | Meaning                                          |
| ---------------- | -------------------------------- | ------------------------------------------------ |
| `chunk`          | `{ content?, reasoning? }`       | Partial text from the model                      |
| `done`           | `ConversationDetail`             | Stream complete, full conversation state         |
| `error`          | `{ error }`                      | Unrecoverable stream error                       |
| `title_update`   | `{ title }`                      | Background title generation finished             |
| `schedule_ready` | `{ title, description, prompt }` | `schedule_setup` tool fired; show widget         |
| `questions`      | `{ questions[] }`                | `ask_user` tool fired; show clarification widget |

---

## Async title generation

Title generation is decoupled from the response stream:

- Conversation is usable immediately after the assistant reply finishes.
- Title worker runs in the background using the configured title model.
- `titleSource: "manual"` conversations are never touched by the title service.
- Scheduled run conversations always use `manual` titles (`YYYY-MM-DD — <job title>`).

---

## Production serving

When `client/dist` exists, Fastify serves the built frontend and falls back to `index.html` for non-API routes. No separate web server needed.

---

## Reset flow

`POST /api/reset` calls `resetAllData()` in a single SQLite transaction:

- Deletes all conversations, messages, scheduled jobs, user models, memory tables.
- Deletes `user_profile` and `app_settings` from the settings table (provider profiles are preserved).
- Client clears `localStorage` and redirects to `/profile` to restart onboarding.
