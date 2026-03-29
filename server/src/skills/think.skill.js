export default {
  name: "think",
  description:
    "Think step-by-step before acting. Use this to plan your approach, reason about the task, or evaluate progress. This does NOT execute anything.",
  input_schema: {
    type: "object",
    properties: {
      thought: { type: "string", description: "Internal reasoning / planning" },
      phase: {
        type: "string",
        enum: ["PLANNING", "EXECUTING", "CHECKING"],
        description: "Current phase of the loop",
      },
    },
    required: ["thought", "phase"],
  },
  execute(input = {}) {
    return { thought_recorded: true, phase: input.phase };
  },
};
