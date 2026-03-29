import { runMemoryMigrations } from "./schema.js";
import { logger } from "../utils/logger.js";
import {
  insertChatMessage,
  upsertChatMemoryState,
  getUnprocessedMessages,
  getChatMemoryState,
  insertJob,
  getChatIds,
  backfillExistingMessages,
} from "./memoryDb.js";
import { buildContext } from "./retrieval.js";
import { JobRunner, scheduleDailyDecay } from "./jobRunner.js";
import type { MemoryModule, MemoryModuleConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { createHostAdapter, notifyMemoryOfMessage } from "./hostAdapter.js";
export type {
  HostMessage,
  ChatHistoryAdapter,
  MemoryModuleConfig,
  MemoryModule,
  EpisodeRow,
  MemoryNoteRow,
  MemoryBlockRow,
  MemoryJobRow,
  ChatMemoryStateRow,
  NoteKind,
  NoteScope,
  BlockKind,
  JobKind,
  NoteAction,
  EpisodeData,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCAL_USER = "local_user";
const EPISODE_TRIGGER_MIN_MESSAGES = 6;
const EPISODE_TRIGGER_MINUTES = 5;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMemoryModule(): MemoryModule {
  let _config: MemoryModuleConfig | null = null;
  const jobRunner = new JobRunner();

  return {
    async init(config: MemoryModuleConfig): Promise<void> {
      _config = config;

      // Run schema migrations (idempotent)
      runMemoryMigrations();

      // Backfill existing chat history into mem_chat_messages (idempotent)
      backfillExistingMessages();

      // On every startup, enqueue episode jobs for any chat that still has
      // unprocessed messages (covers restarts after failed runs)
      const backfillMin = config.options?.episodeMinMessages ?? EPISODE_TRIGGER_MIN_MESSAGES;
      const allChatIds = await config.adapter.getChatIds();
      for (const chatId of allChatIds) {
        const state = getChatMemoryState(chatId);
        const unprocessed = getUnprocessedMessages(
          chatId,
          state?.last_processed_message_id ?? null,
          backfillMin + 1
        );
        if (unprocessed.length >= backfillMin) {
          insertJob({ kind: "build_episodes", userId: LOCAL_USER, chatId });
        }
      }

      // Wire up the adapter's onMessage listener
      config.adapter.onMessage(async (msg) => {
        // 1. Mirror message into mem_chat_messages (dedup via INSERT OR IGNORE)
        insertChatMessage(msg);

        // 2. Mark chat as dirty
        upsertChatMemoryState(msg.chatId, { dirty: true });

        // 3. Check if we should enqueue episode building
        await maybeEnqueueEpisodeBuild(msg.chatId, LOCAL_USER, config);
      });
    },

    start(userId: string): () => void {
      if (!_config) {
        throw new Error("MemoryModule.init() must be called before start()");
      }

      // Start the background job runner
      jobRunner.start(_config);

      // Schedule daily salience decay (fire-and-forget)
      scheduleDailyDecay(userId, _config).catch((err) => {
        logger.error(err, "[memory] Failed to schedule daily decay");
      });

      return () => {
        jobRunner.stop();
      };
    },

    async query(params: {
      userId: string;
      chatId: string;
      currentMessage: string;
    }): Promise<string> {
      if (!_config) {
        throw new Error("MemoryModule.init() must be called before query()");
      }

      const embedFn = _config.embed ?? null;

      // If no embed function, provide a fallback that returns an empty vector
      const safeEmbed = embedFn ? embedFn : async (_text: string): Promise<number[]> => [];

      return buildContext({
        userId: params.userId,
        chatId: params.chatId,
        currentMessage: params.currentMessage,
        embed: safeEmbed,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function maybeEnqueueEpisodeBuild(
  chatId: string,
  userId: string,
  config: MemoryModuleConfig
): Promise<void> {
  const minMessages = config.options?.episodeMinMessages ?? EPISODE_TRIGGER_MIN_MESSAGES;

  try {
    const state = getChatMemoryState(chatId);
    const unprocessed = getUnprocessedMessages(
      chatId,
      state?.last_processed_message_id ?? null,
      minMessages + 1
    );

    const hasEnoughMessages = unprocessed.length >= minMessages;

    // Also trigger if there are any new messages and the last episode was > 5 min ago
    let staleTrigger = false;
    if (!hasEnoughMessages && unprocessed.length > 0) {
      const lastEpisodeCheck = state?.updated_at;
      if (lastEpisodeCheck) {
        const minutesElapsed = (Date.now() - new Date(lastEpisodeCheck).getTime()) / 60_000;
        staleTrigger = minutesElapsed >= EPISODE_TRIGGER_MINUTES;
      }
    }

    if (hasEnoughMessages || staleTrigger) {
      insertJob({ kind: "build_episodes", userId, chatId });
    }
  } catch (err) {
    logger.error(err, "[memory] Error in maybeEnqueueEpisodeBuild");
  }
}
