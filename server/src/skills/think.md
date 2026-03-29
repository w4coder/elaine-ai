# think

## Description

Think step-by-step before acting. Use this to plan your approach, reason about the task, or evaluate progress. This does not execute anything.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "thought": {
      "type": "string",
      "description": "Internal reasoning / planning"
    },
    "phase": {
      "type": "string",
      "enum": ["PLANNING", "EXECUTING", "CHECKING"],
      "description": "Current phase of the loop"
    }
  },
  "required": ["thought", "phase"]
}
```

## Execution Snippet

```js
const input = {
  thought: "Plan the approach before using other tools.",
  phase: "PLANNING",
};

const result = await Promise.resolve(skillRegistry.execTool("think", input));
// Expected result: { thought_recorded: true, phase: "PLANNING" }
```
