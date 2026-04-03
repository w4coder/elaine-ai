/**
 * Search previous conversations for messages relevant to a natural-language query.
 * The host injects `conversationSearch(query, limit)` into the skill context.
 */

export default {
  name: "conversation_search",
  description:
    "Search previous chats for messages relevant to a query. " +
    "Use this when the answer depends on what was said in earlier conversations rather than long-term memory notes.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural-language query describing what to find in earlier conversations.",
      },
      limit: {
        type: "number",
        description: "Maximum number of matching chat excerpts to return (default: 5, max: 20).",
      },
    },
    required: ["query"],
  },

  execute(input = {}, context = {}) {
    if (!input.query || typeof input.query !== "string") {
      return { error: 'Missing required "query" string.' };
    }

    const limit = Math.min(Number.isFinite(input.limit) ? input.limit : 5, 20);
    const conversationSearch = context.conversationSearch;

    if (typeof conversationSearch !== "function") {
      return {
        results: [],
        note: "Conversation search is not available in this context.",
      };
    }

    try {
      const results = conversationSearch(input.query, limit);

      if (!results || results.length === 0) {
        return {
          results: [],
          note: "No relevant previous chats found for this query.",
        };
      }

      return {
        results: results.map((result, index) => ({
          rank: index + 1,
          conversationId: result.conversationId,
          title: result.title,
          updatedAt: result.updatedAt,
          messageId: result.messageId,
          role: result.role,
          snippet: result.snippet,
          score: Math.round(result.score * 100) / 100,
        })),
        total: results.length,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Conversation search failed." };
    }
  },
};
