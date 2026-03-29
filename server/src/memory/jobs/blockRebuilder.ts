import { getActiveNotesByKind, getChatNotesForKind, upsertMemoryBlock } from "../memoryDb.js";
import { logger } from "../../utils/logger.js";
import type { BlockKind, NoteKind, MemoryNoteRow } from "../types.js";

const BLOCK_TO_NOTE_KIND: Record<BlockKind, NoteKind> = {
  projects: "project",
  preferences: "preference",
  constraints: "constraint",
  active_tasks: "task",
};

function formatBlock(notes: MemoryNoteRow[]): string {
  return notes
    .sort((a, b) => b.salience - a.salience)
    .map((n) => `• ${n.summary}`)
    .join("\n");
}

export async function rebuildBlocks(
  userId: string,
  chatId: string | null,
  _llm: (prompt: string) => Promise<string>
): Promise<void> {
  const blockKinds: BlockKind[] = ["projects", "preferences", "constraints", "active_tasks"];

  for (const blockKind of blockKinds) {
    const noteKind = BLOCK_TO_NOTE_KIND[blockKind];

    const globalNotes = getActiveNotesByKind(userId, noteKind);
    const chatNotes: MemoryNoteRow[] = chatId ? getChatNotesForKind(userId, chatId, noteKind) : [];

    const seenIds = new Set<string>();
    const allNotes: MemoryNoteRow[] = [];
    for (const note of [...globalNotes, ...chatNotes]) {
      if (!seenIds.has(note.id)) {
        seenIds.add(note.id);
        allNotes.push(note);
      }
    }

    if (allNotes.length === 0) continue;

    try {
      upsertMemoryBlock({
        userId,
        chatId: chatId ?? null,
        kind: blockKind,
        content: formatBlock(allNotes),
        builtFromNoteIds: allNotes.map((n) => n.id),
      });
    } catch (err) {
      logger.error({ blockKind, err }, "[blockRebuilder] Failed to upsert block");
    }
  }
}
