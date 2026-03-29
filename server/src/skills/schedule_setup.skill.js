/**
 * schedule_setup.skill.js
 *
 * Called by the AI when it has fully understood a scheduling request.
 * Returns the plan data, which the agent loop emits as a special
 * `scheduleReady` stream chunk — triggering the setup widget in the UI.
 *
 * Mirrors the ask_user pattern: emits widget data and exits the loop.
 */

export default {
  name: "schedule_setup",

  description:
    "Call this once you fully understand the user's recurring task request and are ready to " +
    "present the schedule configuration widget. Provide a short title, a one-sentence description " +
    "of what will run on each execution, and the exact prompt that will be sent on each scheduled run. " +
    "Do NOT call this while you still have clarifying questions — use ask_user first if needed.",

  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short task title (max 60 characters).",
      },
      description: {
        type: "string",
        description: "What this task will do on each run (1–2 sentences).",
      },
      prompt: {
        type: "string",
        description: "The exact message that will be sent on each scheduled execution.",
      },
    },
    required: ["title", "description", "prompt"],
  },

  execute(input = {}) {
    const title = String(input.title ?? "")
      .trim()
      .slice(0, 60);
    const description = String(input.description ?? "").trim();
    const prompt = String(input.prompt ?? "").trim();

    if (!title) return { error: "title is required." };
    if (!description) return { error: "description is required." };
    if (!prompt) return { error: "prompt is required." };

    return { scheduleReady: true, title, description, prompt };
  },
};
