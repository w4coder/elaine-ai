import { randomUUID } from "node:crypto";
import { extractJson } from "../../utils/extractJson.js";
import { logger } from "../../utils/logger.js";
import {
  acquireLock,
  releaseLock,
  getUnprocessedMessages,
  getChatMemoryState,
  upsertChatMemoryState,
  insertEpisode,
  insertJob,
} from "../memoryDb.js";
import type { EpisodeData } from "../types.js";

const LOCAL_USER = "local_user";
const MIN_MESSAGES = 6;
const CHUNK_SIZE = 20;

function buildEpisodePrompt(messages: Array<{ role: string; content: string }>): string {
  const formatted = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  return `You are a memory extraction assistant. Given a batch of chat messages between a user and their AI assistant, produce a structured episode summary.

Return ONLY valid JSON matching this schema:
{"summary": string, "entities": string[], "topics": string[], "outcome": string | null, "importance": number}

Messages:
${formatted}`;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function buildEpisodes(
  chatId: string,
  userId: string,
  llm: (prompt: string) => Promise<string>
): Promise<void> {
  const jobId = randomUUID();
  const locked = acquireLock(chatId, jobId);

  if (!locked) {
    // Another job is processing this chat — skip
    return;
  }

  try {
    const state = getChatMemoryState(chatId);
    const messages = getUnprocessedMessages(chatId, state?.last_processed_message_id ?? null, 100);

    logger.info({ chatId, messageCount: messages.length }, "[episodeBuilder] processing");

    if (messages.length < MIN_MESSAGES) {
      logger.info(
        { messageCount: messages.length, min: MIN_MESSAGES },
        "[episodeBuilder] not enough messages, skipping"
      );
      releaseLock(chatId);
      return;
    }

    const chunks = chunkArray(messages, CHUNK_SIZE);
    let lastProcessedMessageId: string | null = null;

    for (const chunk of chunks) {
      const prompt = buildEpisodePrompt(chunk.map((m) => ({ role: m.role, content: m.content })));

      let episodeData: EpisodeData;
      try {
        const raw = await llm(prompt);
        logger.debug(
          { chars: raw.length, sample: raw.slice(0, 500) },
          "[episodeBuilder] LLM response"
        );
        episodeData = extractJson(raw) as EpisodeData;
      } catch (err) {
        logger.error(err, "[episodeBuilder] Failed to parse LLM response");
        continue;
      }

      const firstMsg = chunk[0];
      const lastMsg = chunk[chunk.length - 1];

      insertEpisode({
        id: randomUUID(),
        chat_id: chatId,
        from_message_id: firstMsg.id,
        to_message_id: lastMsg.id,
        summary: episodeData.summary ?? "",
        entities: JSON.stringify(Array.isArray(episodeData.entities) ? episodeData.entities : []),
        topics: JSON.stringify(Array.isArray(episodeData.topics) ? episodeData.topics : []),
        outcome: episodeData.outcome ?? null,
        importance: typeof episodeData.importance === "number" ? episodeData.importance : 0.5,
        processed_for_notes: 0,
      });

      lastProcessedMessageId = lastMsg.id;
    }

    if (lastProcessedMessageId) {
      upsertChatMemoryState(chatId, {
        lastProcessedMessageId,
        dirty: false,
      });

      // Enqueue note extraction for this chat
      insertJob({
        kind: "extract_notes",
        userId: userId ?? LOCAL_USER,
        chatId,
      });
    }
  } finally {
    releaseLock(chatId);
  }
}
