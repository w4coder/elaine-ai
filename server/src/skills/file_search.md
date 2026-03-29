# file_search

## Description

Search for files by name pattern or content. Returns matching file paths.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Pattern to match file names, e.g. \"*.js\" or \"config\""
    },
    "directory": {
      "type": "string",
      "description": "Directory to search in (defaults to cwd)",
      "default": "."
    },
    "content": {
      "type": "string",
      "description": "Optional: search for this text inside files"
    }
  },
  "required": ["pattern"]
}
```

## Execution Snippet

```js
const input = {
  pattern: "*.js",
  directory: "backend/src",
  content: "agentRunner",
};

const result = await Promise.resolve(skillRegistry.execTool("file_search", input));
// Expected result shape: { matches: [...], count: number }
```
