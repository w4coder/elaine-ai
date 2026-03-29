# web_fetch

## Description

Fetch text content from a URL.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "URL to fetch"
    },
    "excerpt": {
      "type": "number",
      "description": "Max characters to return (default 4000)",
      "default": 4000
    }
  },
  "required": ["url"]
}
```

## Execution Snippet

```js
const input = {
  url: "https://example.com",
  excerpt: 2000,
};

const result = await Promise.resolve(skillRegistry.execTool("web_fetch", input));
// Expected result shape: { content: string, total_chars: number, url: string } or { error: string, url?: string }
```
