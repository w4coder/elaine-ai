import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../lib/api";
import type { ConversationDetail, ConversationSummary } from "../lib/types";

export interface UseConversationListOptions {
  activeConversationId: string | null;
  setActiveConversation: Dispatch<SetStateAction<ConversationDetail | null>>;
  setTitleDraft: (v: string) => void;
  setActiveConversationId: Dispatch<SetStateAction<string | null>>;
}

export interface UseConversationListResult {
  conversations: ConversationSummary[];
  setConversations: Dispatch<SetStateAction<ConversationSummary[]>>;
}

export function useConversationList(opts: UseConversationListOptions): UseConversationListResult {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    const unsubscribe = api.subscribeConversationEvents({
      onUpsert: ({ conversation }) => {
        setConversations((current) => {
          const next = current.some((entry) => entry.id === conversation.id)
            ? current.map((entry) => (entry.id === conversation.id ? conversation : entry))
            : [conversation, ...current];
          return [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        });

        if (conversation.id === opts.activeConversationId) {
          opts.setActiveConversation((current) =>
            current
              ? {
                  ...current,
                  title: conversation.title,
                  titleStatus: conversation.titleStatus,
                  titleSource: conversation.titleSource,
                  updatedAt: conversation.updatedAt,
                }
              : current
          );
          opts.setTitleDraft(conversation.title);
        }
      },
      onDelete: ({ conversationId }) => {
        setConversations((current) => current.filter((entry) => entry.id !== conversationId));
        if (conversationId === opts.activeConversationId) {
          opts.setActiveConversationId(null);
          opts.setActiveConversation(null);
        }
      },
    });

    return unsubscribe;
  }, [opts.activeConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { conversations, setConversations };
}
