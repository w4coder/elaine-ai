/**
 * ask_user.skill.js
 *
 * Pauses the agent and displays a multi-question widget in the chat UI.
 * Returns the questions array to the agent loop, which emits them as a
 * special `questions` stream chunk and exits — the conversation resumes
 * when the user submits their answers as the next message.
 */

export default {
  name: "ask_user",

  description:
    "Pause and ask the user one or more clarifying questions before continuing. " +
    "Each question can include up to 3 short suggested answers; the user may also type their own. " +
    "Use this whenever you need information from the user to complete the task correctly. " +
    "Do NOT use this for every message — only when genuinely missing critical details.",

  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "List of questions to ask the user (1–10).",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The question text shown to the user.",
            },
            suggestions: {
              type: "array",
              description: "Up to 3 short suggested answers the user can pick from.",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["question"],
        },
      },
    },
    required: ["questions"],
  },

  execute(input = {}) {
    let rawQuestions = input.questions;
    // Some models double-encode the array as a JSON string
    if (typeof rawQuestions === "string") {
      try {
        rawQuestions = JSON.parse(rawQuestions);
      } catch {
        rawQuestions = [];
      }
    }
    const questions = (Array.isArray(rawQuestions) ? rawQuestions : [])
      .slice(0, 10)
      .map((q) => ({
        question: String(q.question || "").trim(),
        suggestions: Array.isArray(q.suggestions)
          ? q.suggestions
              .slice(0, 3)
              .map((s) => String(s).trim())
              .filter(Boolean)
          : [],
      }))
      .filter((q) => q.question);

    if (!questions.length) {
      return { error: "No valid questions provided." };
    }

    return { questions };
  },
};
