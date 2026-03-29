export default {
  name: "task_done",
  description: "Signal that the task is complete. Provide final output and self-evaluation.",
  input_schema: {
    type: "object",
    properties: {
      output: { type: "string", description: "Final result / answer / deliverable" },
      score: { type: "number", description: "Self-evaluation score 0.0-1.0" },
      issues: { type: "array", items: { type: "string" }, description: "Any issues/caveats" },
      recommendation: {
        type: "string",
        enum: ["ACCEPT", "RETRY", "FAIL"],
        description: "ACCEPT, RETRY, or FAIL",
      },
    },
    required: ["output", "score", "recommendation"],
  },
  execute() {
    return { acknowledged: true };
  },
};
