# shell_exec

## Description

Execute a shell command and return stdout + stderr.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "Shell command to run"
    },
    "cwd": {
      "type": "string",
      "description": "Working directory (defaults to cwd)",
      "default": "."
    }
  },
  "required": ["command"]
}
```

## Execution Snippet

```js
const input = {
  command: "ls -la backend/src",
  cwd: ".",
};

const result = await Promise.resolve(skillRegistry.execTool("shell_exec", input));
// Expected result shape: { stdout: string, exit_code: number, stderr?: string }
```
