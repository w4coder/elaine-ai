# task_done

## Description

Signal that the task is complete. Provide final output and self-evaluation.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "output": {
      "type": "string",
      "description": "Final result / answer / deliverable"
    },
    "score": {
      "type": "number",
      "description": "Self-evaluation score 0.0-1.0"
    },
    "issues": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Any issues/caveats"
    },
    "recommendation": {
      "type": "string",
      "enum": ["ACCEPT", "RETRY", "FAIL"],
      "description": "ACCEPT, RETRY, or FAIL"
    }
  },
  "required": ["output", "score", "recommendation"]
}
```

## Execution Snippet

```js
const input = {
  output: "Implemented requested change and validated build.",
  score: 0.92,
  recommendation: "ACCEPT",
  issues: [],
};

// In the loop, task_done is handled as a completion signal and not executed via execTool.
finalResult = {
  output: input.output,
  score: Number(input.score ?? 0),
  recommendation: input.recommendation || "RETRY",
  issues: Array.isArray(input.issues) ? input.issues : [],
};
```
