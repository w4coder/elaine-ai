import type { ConversationSummary } from "../types.js";

export type ConversationEvent =
  | { type: "upsert"; conversation: ConversationSummary }
  | { type: "delete"; conversationId: string };

class ConversationEvents {
  private readonly listeners = new Set<(event: ConversationEvent) => void>();

  subscribe(listener: (event: ConversationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: ConversationEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const conversationEvents = new ConversationEvents();
