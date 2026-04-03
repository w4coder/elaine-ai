import { listConversationSearchResults } from "../db/repository.js";
import { getActiveNotes } from "../memory/memoryDb.js";
import type { MemoryNoteRow } from "../memory/types.js";

export interface MemorySearchResult {
  kind: string;
  summary: string;
  confidence: number;
  scope: string;
  entities: string[];
}

export interface ConversationSearchResult {
  conversationId: string;
  title: string;
  updatedAt: string;
  messageId: string;
  role: "user" | "assistant";
  snippet: string;
  score: number;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function getQueryTerms(query: string): string[] {
  return [
    ...new Set(
      normalizeQuery(query)
        .split(/\s+/)
        .filter((term) => term.length >= 3)
    ),
  ].slice(0, 8);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getRecencyScore(isoDate: string, decayDays = 30): number {
  const ageDays = Math.max(0, (Date.now() - new Date(isoDate).getTime()) / 86_400_000);
  return Math.exp(-ageDays / decayDays);
}

function scoreText(text: string, query: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let score = lower.includes(query) ? 1 : 0;

  for (const term of terms) {
    if (lower.includes(term)) {
      score += 0.2;
    }
  }

  return score;
}

function scoreMemoryNote(note: MemoryNoteRow, query: string, terms: string[]): number {
  const textScore = scoreText(note.summary, query, terms);
  const salienceScore = clamp(note.salience, 0, 1);
  const confidenceScore = clamp(note.confidence, 0, 1);
  const recencyScore = getRecencyScore(note.updated_at);

  return textScore * 0.5 + salienceScore * 0.2 + confidenceScore * 0.15 + recencyScore * 0.15;
}

export function createMemorySearchFn(userId: string) {
  return function memorySearch(query: string, limit = 5): MemorySearchResult[] {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) {
      return [];
    }

    const terms = getQueryTerms(normalizedQuery);
    const notes = getActiveNotes(userId, 200);

    return notes
      .map((note) => ({
        note,
        score: scoreMemoryNote(note, normalizedQuery, terms),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map(({ note }) => ({
        kind: note.kind,
        summary: note.summary,
        confidence: note.confidence,
        scope: note.scope,
        entities: [],
      }));
  };
}

export function createConversationSearchFn() {
  return function conversationSearch(query: string, limit = 5): ConversationSearchResult[] {
    return listConversationSearchResults(query, limit);
  };
}
