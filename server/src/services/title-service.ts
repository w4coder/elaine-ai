import {
  getConversation,
  getConversationSummary,
  getSettings,
  updateConversation,
} from "../db/repository.js";
import { getProviderAdapter, getProfile } from "../providers/index.js";
import { conversationEvents } from "./conversation-events.js";
import { TITLE_MAX_LENGTH, TITLE_PROMPT } from "../utils/constants.js";
import type { ProviderMessage } from "../types.js";

function sanitizeTitle(title: string): string {
  return title
    .replace(/[\r\n]+/g, " ")
    .replace(/["“”]/g, "")
    .trim()
    .slice(0, TITLE_MAX_LENGTH);
}

function fallbackTitle(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.slice(0, TITLE_MAX_LENGTH) || "New conversation";
}

export class TitleService {
  private readonly pending = new Set<string>();

  schedule(conversationId: string): void {
    if (this.pending.has(conversationId)) {
      return;
    }

    this.pending.add(conversationId);
    setTimeout(() => {
      void this.run(conversationId).finally(() => {
        this.pending.delete(conversationId);
      });
    }, 0);
  }

  private async run(conversationId: string): Promise<void> {
    const settings = getSettings();
    if (!settings.titleGenerationEnabled) {
      return;
    }

    const conversation = getConversation(conversationId);
    if (!conversation || conversation.titleSource === "manual") {
      return;
    }

    const profile = getProfile(settings, conversation.profileId);
    const model = conversation.model.trim();
    if (!model) {
      return;
    }

    const userMessages = conversation.messages.filter((message) => message.role === "user");
    if (!userMessages.length) {
      return;
    }

    updateConversation(conversationId, { titleStatus: "generating" });

    try {
      const transcript = conversation.messages
        .slice(-6)
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n\n");

      const prompt: ProviderMessage[] = [
        {
          role: "system",
          content: TITLE_PROMPT,
        },
        {
          role: "user",
          content: transcript,
        },
      ];

      const adapter = getProviderAdapter(profile.providerType);
      const { content } = await adapter.completeChat({
        profile,
        model,
        messages: prompt,
        think: false,
      });
      const generated = sanitizeTitle(content);

      updateConversation(conversationId, {
        title: generated || fallbackTitle(userMessages[0].content),
        titleStatus: "ready",
        titleSource: "generated",
      });
      this.publishConversationUpdate(conversationId);
    } catch {
      updateConversation(conversationId, {
        title: fallbackTitle(userMessages[0].content),
        titleStatus: "error",
        titleSource: "generated",
      });
      this.publishConversationUpdate(conversationId);
    }
  }

  private publishConversationUpdate(conversationId: string): void {
    const summary = getConversationSummary(conversationId);
    if (!summary) {
      return;
    }

    conversationEvents.publish({
      type: "upsert",
      conversation: summary,
    });
  }
}
