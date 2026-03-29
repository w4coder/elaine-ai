# file_write

## Description

Write or append content to a file.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Path to write to"
    },
    "content": {
      "type": "string",
      "description": "Content to write"
    },
    "append": {
      "type": "boolean",
      "description": "If true, append instead of overwrite",
      "default": false
    }
  },
  "required": ["path", "content"]
}
```

## Execution Snippet

```js
const input = {
  path: "backend/tokyo_trip_plan.md",
  content: "# Tokyo Trip Plan\n\n- Day 1: Asakusa\n",
  append: false,
};

const result = await Promise.resolve(skillRegistry.execTool("file_write", input));
// Expected result shape:
// { written: true, path: string, bytes: number, existed_before: boolean, mode: "append"|"overwrite" }
```
