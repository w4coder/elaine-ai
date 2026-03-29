/**
 * memory_search.skill.js
 *
 * Search the user's long-term memory for notes relevant to a query.
 * Available in both chat and task modes.
 *
 * The server injects a `memorySearch(query, limit)` function into the skill
 * context at call time, so this skill stays dependency-free.
 */

export default {
  name: "memory_search",
  description:
    "Search the user's personal memory for notes, preferences, projects, facts, constraints, or tasks that are relevant to a query. " +
    "Use this before answering questions that depend on past context, user preferences, or ongoing projects. " +
    "Returns up to `limit` ranked memory notes.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural-language search query — what you are looking for in memory.",
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default: 5, max: 20).",
      },
    },
    required: ["query"],
  },

  execute(input = {}, context = {}) {
    if (!input.query || typeof input.query !== "string") {
      return { error: 'Missing required "query" string.' };
    }

    const limit = Math.min(Number.isFinite(input.limit) ? input.limit : 5, 20);

    const memorySearch = context.memorySearch;
    if (typeof memorySearch !== "function") {
      return {
        results: [],
        note: "Memory search is not available in this context.",
      };
    }

    try {
      const results = memorySearch(input.query, limit);

      if (!results || results.length === 0) {
        return {
          results: [],
          note: "No relevant memory found for this query.",
        };
      }

      return {
        results: results.map((r, i) => ({
          rank: i + 1,
          kind: r.kind,
          scope: r.scope,
          summary: r.summary,
          confidence: Math.round(r.confidence * 100) / 100,
          entities: r.entities,
        })),
        total: results.length,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Memory search failed." };
    }
  },
};
