import { nowIso } from "../../utils/time.js";
import { getActiveNotes, updateNote } from "../memoryDb.js";

const DECAY_RATE_GLOBAL = 0.98;
const DECAY_RATE_CHAT = 0.95;
const ARCHIVE_THRESHOLD_CHAT = 0.1;

/**
 * Apply salience decay to all active notes for a user.
 * - Global notes decay at 0.98 per decay cycle
 * - Chat notes decay at 0.95 per decay cycle
 * - Chat notes with salience below 0.1 are archived
 * - Pinned notes are never modified
 */
export async function decaySalience(userId: string): Promise<void> {
  const notes = getActiveNotes(userId, 10_000);

  for (const note of notes) {
    // Never touch user-pinned notes
    if (note.pinned_by_user) continue;

    const decayRate = note.scope === "global" ? DECAY_RATE_GLOBAL : DECAY_RATE_CHAT;
    const newSalience = note.salience * decayRate;

    if (note.scope === "chat" && newSalience < ARCHIVE_THRESHOLD_CHAT) {
      updateNote(note.id, { status: "archived", salience: newSalience });
    } else {
      updateNote(note.id, { salience: newSalience });
    }
  }
}
