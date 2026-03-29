import { getMemoryBlocks, getRecentMessages, getActiveNotes } from "./memoryDb.js";
import { logger } from "../utils/logger.js";
import type { MemoryNoteRow, MemoryBlockRow } from "./types.js";

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function daysBetween(isoA: string, isoB: string): number {
  const msA = new Date(isoA).getTime();
  const msB = new Date(isoB).getTime();
  return Math.abs(msB - msA) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Note scoring
// ---------------------------------------------------------------------------

export function scoreNote(note: MemoryNoteRow, queryEmbedding: number[]): number {
  const now = new Date().toISOString();

  // Semantic similarity (0–1)
  let semantic = 0;
  if (queryEmbedding.length > 0 && note.embedding) {
    try {
      const noteEmbedding = JSON.parse(note.embedding) as number[];
      semantic = cosineSimilarity(queryEmbedding, noteEmbedding);
    } catch {
      semantic = 0;
    }
  }

  // Recency (0–1, exponential decay over 30 days)
  const days = daysBetween(note.updated_at, now);
  const recency = Math.exp(-days / 30);

  // Salience already normalized 0–1
  const salience = Math.max(0, Math.min(1, note.salience));

  return semantic * 0.5 + recency * 0.25 + salience * 0.25;
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

function assemblePrompt(params: {
  globalBlocks: MemoryBlockRow[];
  chatBlocks: MemoryBlockRow[];
  topNotes: MemoryNoteRow[];
  recentMessages: Array<{ role: string; content: string }>;
}): string {
  const sections: string[] = [];

  // User memory blocks (global)
  const allBlocks = [...params.globalBlocks, ...params.chatBlocks];
  if (allBlocks.length > 0) {
    const blockText = allBlocks
      .map((b) => {
        const label = b.kind.replace(/_/g, " ");
        return `**${label.charAt(0).toUpperCase() + label.slice(1)}**\n${b.content}`;
      })
      .join("\n\n");

    sections.push(`### User Memory\n${blockText}`);
  }

  // Top semantically relevant notes not already in blocks
  if (params.topNotes.length > 0) {
    const noteText = params.topNotes.map((n) => `- [${n.kind}] ${n.summary}`).join("\n");

    sections.push(`### Relevant Context\n${noteText}`);
  }

  // Recent messages
  if (params.recentMessages.length > 0) {
    const msgText = params.recentMessages.map((m) => `${m.role}: ${m.content}`).join("\n");

    sections.push(`### Recent Messages\n${msgText}`);
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function buildContext(params: {
  userId: string;
  chatId: string;
  currentMessage: string;
  embed: (text: string) => Promise<number[]>;
}): Promise<string> {
  // Embed the query (may return empty array if embedding is unavailable)
  let queryEmbedding: number[] = [];
  try {
    queryEmbedding = await params.embed(params.currentMessage);
  } catch (err) {
    logger.warn(err, "[retrieval] Embedding failed, falling back to recency+salience scoring");
  }

  // Fetch everything in parallel
  const [globalBlocks, chatBlocks, recentMessages, allActiveNotes] = await Promise.all([
    Promise.resolve(getMemoryBlocks(params.userId, null)),
    Promise.resolve(getMemoryBlocks(params.userId, params.chatId)),
    Promise.resolve(getRecentMessages(params.chatId, 20)),
    Promise.resolve(getActiveNotes(params.userId)),
  ]);

  // Score and rank notes
  const scored = allActiveNotes.map((note) => ({
    note,
    score: scoreNote(note, queryEmbedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  const topNotes = scored.slice(0, 5).map((s) => s.note);

  return assemblePrompt({
    globalBlocks: globalBlocks.filter((b) => b.chat_id === null),
    chatBlocks: chatBlocks.filter((b) => b.chat_id === params.chatId),
    topNotes,
    recentMessages: recentMessages.map((m) => ({ role: m.role, content: m.content })),
  });
}
