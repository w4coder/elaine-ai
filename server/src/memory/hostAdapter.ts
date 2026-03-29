import { EventEmitter } from "node:events";
import { db } from "../db/database.js";
import type { ChatHistoryAdapter, HostMessage } from "./types.js";

// ---------------------------------------------------------------------------
// Internal event bus
// ---------------------------------------------------------------------------

const memoryEventBus = new EventEmitter();
memoryEventBus.setMaxListeners(50);

// ─── Raw SQLite row type ──────────────────────────────────────────────────────

interface AppMessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row mapper: convert the app's `messages` table row → HostMessage
// ---------------------------------------------------------------------------
function mapMessageRow(row: AppMessageRow): HostMessage {
  return {
    id: row.id,
    chatId: row.conversation_id,
    role: row.role as HostMessage["role"],
    content: row.content,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Host adapter implementation
// ---------------------------------------------------------------------------

export function createHostAdapter(): ChatHistoryAdapter {
  return {
    async getMessages(
      chatId: string,
      afterMessageId?: string | null,
      limit: number = 100
    ): Promise<HostMessage[]> {
      if (afterMessageId) {
        const cursor = db
          .prepare("SELECT created_at FROM messages WHERE id = ?")
          .get(afterMessageId) as { created_at: string } | undefined;

        if (!cursor) {
          return [];
        }

        const rows = db
          .prepare(
            `SELECT * FROM messages
             WHERE conversation_id = ? AND created_at > ?
             ORDER BY created_at ASC
             LIMIT ?`
          )
          .all(chatId, cursor.created_at, limit) as AppMessageRow[];

        return rows.map(mapMessageRow);
      }

      const rows = db
        .prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at ASC
           LIMIT ?`
        )
        .all(chatId, limit) as AppMessageRow[];

      return rows.map(mapMessageRow);
    },

    async getChatIds(): Promise<string[]> {
      const rows = db
        .prepare("SELECT DISTINCT conversation_id FROM messages ORDER BY conversation_id")
        .all() as Array<{ conversation_id: string }>;

      return rows.map((r) => r.conversation_id);
    },

    onMessage(handler: (msg: HostMessage) => void): void {
      memoryEventBus.on("message", handler);
    },
  };
}

/**
 * Call this whenever a new message is persisted to the host app's messages table.
 * The memory module subscribes via `adapter.onMessage()` and will pick it up.
 */
export function notifyMemoryOfMessage(msg: HostMessage): void {
  memoryEventBus.emit("message", msg);
}
