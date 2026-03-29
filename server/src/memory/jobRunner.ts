import { getNextPendingJob, claimJob, completeJob, failJob, insertJob } from "./memoryDb.js";
import { logger } from "../utils/logger.js";
import { buildEpisodes } from "./jobs/episodeBuilder.js";
import { extractNotes } from "./jobs/noteExtractor.js";
import { rebuildBlocks } from "./jobs/blockRebuilder.js";
import { decaySalience } from "./jobs/salienceDecay.js";
import type { MemoryModuleConfig } from "./types.js";

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_DECAY_INTERVAL_MS = 24 * 60 * 60 * 1_000; // 24 hours

export class JobRunner {
  private interval: NodeJS.Timeout | null = null;
  private decayInterval: NodeJS.Timeout | null = null;
  private running = false;

  start(config: MemoryModuleConfig): void {
    if (this.interval) return; // Already started

    const intervalMs = config.options?.jobIntervalMs ?? DEFAULT_INTERVAL_MS;

    this.interval = setInterval(() => {
      if (this.running) return; // Prevent overlapping runs
      this.running = true;
      this.processNextJob(config).finally(() => {
        this.running = false;
      });
    }, intervalMs);

    // Unref so the interval doesn't block process exit
    if (this.interval.unref) {
      this.interval.unref();
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
  }

  private async processNextJob(config: MemoryModuleConfig): Promise<void> {
    const job = getNextPendingJob();
    if (!job) return;

    const claimed = claimJob(job.id);
    if (!claimed) return;

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(job.payload) as Record<string, unknown>;
    } catch {
      // Use empty payload
    }

    try {
      switch (job.kind) {
        case "build_episodes":
          await buildEpisodes(
            job.chat_id ?? (payload.chatId as string) ?? "",
            job.user_id,
            config.llm
          );
          break;

        case "extract_notes":
          await extractNotes(
            job.chat_id ?? (payload.chatId as string) ?? "",
            job.user_id,
            config.llm
          );
          break;

        case "rebuild_blocks":
          await rebuildBlocks(
            job.user_id,
            job.chat_id ?? (payload.chatId as string | null) ?? null,
            config.llm
          );
          break;

        case "decay_salience":
          await decaySalience(job.user_id);
          break;

        default:
          logger.warn({ kind: job.kind }, "[JobRunner] Unknown job kind");
      }

      completeJob(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ jobId: job.id, kind: job.kind, message }, "[JobRunner] Job failed");
      failJob(job.id, message);
    }
  }
}

/**
 * Schedule daily salience decay jobs. Enqueues the first decay immediately
 * and then every 24 hours thereafter.
 */
export async function scheduleDailyDecay(
  userId: string,
  config: MemoryModuleConfig
): Promise<void> {
  const intervalMs = config.options?.decayIntervalMs ?? DEFAULT_DECAY_INTERVAL_MS;

  // Enqueue one immediately (run_after = now)
  insertJob({ kind: "decay_salience", userId });

  // Then re-enqueue every intervalMs
  const timer = setInterval(() => {
    insertJob({ kind: "decay_salience", userId });
  }, intervalMs);

  if (timer.unref) {
    timer.unref();
  }
}
