# file_read

## Description

Read the contents of a file.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Path to the file"
    },
    "start_line": {
      "type": "number",
      "description": "First line to read (1-indexed, optional)"
    },
    "end_line": {
      "type": "number",
      "description": "Last line to read (optional)"
    }
  },
  "required": ["path"]
}
```

## Execution Snippet

```js
const input = {
  path: "backend/src/AgentRunner.js",
  start_line: 1,
  end_line: 80,
};

const result = await Promise.resolve(skillRegistry.execTool("file_read", input));
// Expected result shape: { content: string, total_lines: number }
```
