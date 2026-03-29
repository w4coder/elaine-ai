import { randomUUID } from "node:crypto";
import { nowIso } from "../../utils/time.js";
import { extractJson } from "../../utils/extractJson.js";
import { logger } from "../../utils/logger.js";
import {
  getUnprocessedEpisodes,
  markEpisodesProcessed,
  getActiveNotes,
  insertNote,
  getNoteByFingerprint,
  updateNote,
  countChatsWithNote,
  getChatNotesForScope,
  insertJob,
} from "../memoryDb.js";
import { fingerprintNote } from "../fingerprint.js";
import type { NoteAction, MemoryNoteRow } from "../types.js";

const LOCAL_USER = "local_user";

function buildExtractionPrompt(
  episodes: Array<{ summary: string; entities: string[]; topics: string[] }>,
  existingNotes: Array<{ fingerprint: string; kind: string; summary: string; scope: string }>
): string {
  const episodeText = episodes
    .map(
      (e, i) =>
        `Episode ${i + 1}:\n  Summary: ${e.summary}\n  Entities: ${e.entities.join(", ")}\n  Topics: ${e.topics.join(", ")}`
    )
    .join("\n\n");

  const notesText =
    existingNotes.length > 0
      ? existingNotes
          .map(
            (n, i) =>
              `Note ${i + 1} [${n.fingerprint.slice(0, 8)}] (${n.kind}, ${n.scope}): ${n.summary}`
          )
          .join("\n")
      : "(none)";

  return `You are a memory extraction assistant for a personal AI assistant. Analyze the following conversation episodes and extract durable memory notes.

For each insight worth remembering, decide whether to CREATE a new note, UPDATE an existing one, SUPERSEDE (replace) an existing one, or SKIP.

Note kinds: preference | project | fact | constraint | task
Note scopes: chat (specific to this conversation) | global (applies broadly)

Return ONLY a valid JSON array of actions:
[
  {
    "action": "create" | "update" | "supersede" | "skip",
    "kind": "preference" | "project" | "fact" | "constraint" | "task",
    "scope": "chat" | "global",
    "summary": "concise description of the memory",
    "entities": ["entity1", "entity2"],
    "confidence": 0.0-1.0,
    "stability": 0.0-1.0,
    "targetFingerprint": "existing note fingerprint (for update/supersede actions) or null"
  }
]

Guidelines:
- confidence: how certain you are this is accurate
- stability: how likely this is to remain true over time (tasks=low, preferences=medium, facts=high)
- Only extract genuinely useful, durable information
- Prefer updating/superseding over creating duplicates

Existing notes:
${notesText}

New episodes to process:
${episodeText}`;
}

export async function extractNotes(
  chatId: string,
  userId: string,
  llm: (prompt: string) => Promise<string>
): Promise<void> {
  const episodes = getUnprocessedEpisodes(chatId);
  if (episodes.length === 0) return;

  const existingNotes = getActiveNotes(userId, 50);

  const episodeSummaries = episodes.map((ep) => ({
    summary: ep.summary,
    entities: (() => {
      try {
        return JSON.parse(ep.entities) as string[];
      } catch {
        return [];
      }
    })(),
    topics: (() => {
      try {
        return JSON.parse(ep.topics) as string[];
      } catch {
        return [];
      }
    })(),
  }));

  const notesSummary = existingNotes.map((n) => ({
    fingerprint: n.fingerprint,
    kind: n.kind,
    summary: n.summary,
    scope: n.scope,
  }));

  const prompt = buildExtractionPrompt(episodeSummaries, notesSummary);

  let actions: NoteAction[] = [];
  try {
    const raw = await llm(prompt);
    const parsed = extractJson(raw);
    actions = Array.isArray(parsed) ? (parsed as NoteAction[]) : [];
  } catch (err) {
    logger.error(err, "[noteExtractor] Failed to parse LLM response");
    markEpisodesProcessed(episodes.map((e) => e.id));
    return;
  }

  const episodeIds = episodes.map((e) => e.id);

  for (const action of actions) {
    if (action.action === "skip") continue;

    try {
      const fp = fingerprintNote({
        kind: action.kind,
        summary: action.summary,
        entities: action.entities ?? [],
      });

      if (action.action === "create") {
        const existing = getNoteByFingerprint(fp);
        if (existing) {
          // Bump salience instead of duplicating
          updateNote(existing.id, { salience: Math.min(1.0, existing.salience + 0.1) });
          continue;
        }

        insertNote({
          id: randomUUID(),
          fingerprint: fp,
          scope: action.scope ?? "chat",
          chat_id: action.scope === "global" ? null : chatId,
          user_id: userId,
          kind: action.kind,
          summary: action.summary,
          confidence: action.confidence ?? 0.8,
          stability: action.stability ?? 0.5,
          salience: 1.0,
          status: "active",
          pinned_by_user: 0,
          edited_by_user: 0,
          source_episode_ids: JSON.stringify(episodeIds),
          embedding: null,
        });
      } else if (action.action === "update" && action.targetFingerprint) {
        const target = getNoteByFingerprint(action.targetFingerprint);
        if (target && target.edited_by_user === 0) {
          updateNote(target.id, {
            summary: action.summary,
            confidence: action.confidence ?? target.confidence,
            stability: action.stability ?? target.stability,
            salience: Math.min(1.0, target.salience + 0.05),
          });
        }
      } else if (action.action === "supersede" && action.targetFingerprint) {
        const target = getNoteByFingerprint(action.targetFingerprint);
        if (target && target.edited_by_user === 0 && target.pinned_by_user === 0) {
          updateNote(target.id, { status: "superseded" });

          // Create the replacement note
          const newFp = fingerprintNote({
            kind: action.kind,
            summary: action.summary,
            entities: action.entities ?? [],
          });

          if (!getNoteByFingerprint(newFp)) {
            insertNote({
              id: randomUUID(),
              fingerprint: newFp,
              scope: action.scope ?? target.scope,
              chat_id: action.scope === "global" ? null : chatId,
              user_id: userId,
              kind: action.kind,
              summary: action.summary,
              confidence: action.confidence ?? 0.8,
              stability: action.stability ?? 0.5,
              salience: 1.0,
              status: "active",
              pinned_by_user: 0,
              edited_by_user: 0,
              source_episode_ids: JSON.stringify(episodeIds),
              embedding: null,
            });
          }
        }
      }
    } catch (err) {
      logger.error({ action, err }, "[noteExtractor] Error processing action");
    }
  }

  markEpisodesProcessed(episodeIds);

  await promoteNotesToGlobal(userId);

  insertJob({ kind: "rebuild_blocks", userId, chatId });
}

export async function promoteNotesToGlobal(userId: string): Promise<void> {
  // Candidate chat-scope notes with high stability and confidence
  const candidates = getChatNotesForScope(userId, "chat", {
    minStability: 0.8,
    minConfidence: 0.85,
  });

  for (const note of candidates) {
    if (note.pinned_by_user || note.edited_by_user) continue;

    try {
      const entities = (() => {
        // We don't store entities directly on the note, but we can approximate
        // from the summary text — just use the kind as a proxy for entity detection
        return [];
      })();

      const chatCount = countChatsWithNote(userId, note.kind, entities);

      if (chatCount >= 2) {
        updateNote(note.id, { scope: "global", chatId: null });
      }
    } catch (err) {
      logger.error(err, "[noteExtractor] Error promoting note to global");
    }
  }
}
