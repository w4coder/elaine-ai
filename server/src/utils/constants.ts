import type { AppSettings, UserProfile } from "../types.js";

export const DEFAULT_SYSTEM_PROMPT = [
  "You are Elaine, a local-first AI assistant optimized for coding work.",
  "Prioritize precise reasoning, implementation detail, and honest tradeoff analysis.",
  "When the user is building software, act like a strong engineering partner: clarify assumptions, suggest safe defaults, and keep answers practical.",
].join(" ");

export function getDefaultSettings(): AppSettings {
  return {
    activeProfileId: "ollama-local",
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    titleGenerationEnabled: true,
    skillPermissions: { chat: "ask", task: "ask", scheduled: "auto" },
    profiles: [
      {
        id: "ollama-local",
        name: "Ollama Local",
        providerType: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        defaultModel: "llama3.2",
        titleModel: "llama3.2",
        enabled: true,
      },
      {
        id: "vllm-local",
        name: "vLLM Local",
        providerType: "vllm",
        baseUrl: "http://127.0.0.1:8000/v1",
        defaultModel: "",
        titleModel: "",
        enabled: false,
      },
      {
        id: "openai-compatible-local",
        name: "OpenAI Compatible",
        providerType: "openai",
        baseUrl: "http://127.0.0.1:1234/v1",
        defaultModel: "",
        titleModel: "",
        enabled: false,
      },
    ],
  };
}

/**
 * Convert a UserProfile into a compact system-prompt section.
 * Injected into every conversation so the model always knows the user's preferences.
 */
export function buildUserProfilePrompt(profile: UserProfile): string {
  const lines: string[] = [];

  lines.push(`The user's name is ${profile.name}.`);

  if (profile.birthday) {
    lines.push(`Birthday: ${profile.birthday}.`);
  }

  if (profile.gender) {
    lines.push(`Gender: ${profile.gender}.`);
  }

  if (profile.responseLength) {
    const lengthMap: Record<string, string> = {
      brief: "Keep responses concise and to the point.",
      balanced: "Balance completeness with brevity.",
      detailed: "Provide thorough, detailed responses.",
    };
    lines.push(
      lengthMap[profile.responseLength] ?? `Response length preference: ${profile.responseLength}.`
    );
  }

  if (profile.tone) {
    const level =
      profile.toneLevel > 70 ? "very" : profile.toneLevel > 40 ? "moderately" : "slightly";
    lines.push(`Communication style: ${level} ${profile.tone}.`);
  }

  if (profile.focusAreas?.length) {
    lines.push(`Primary focus areas: ${profile.focusAreas.join(", ")}.`);
  }

  if (profile.proactiveness > 65) {
    lines.push("Be proactive: anticipate follow-up needs and suggest next steps.");
  } else if (profile.proactiveness < 35) {
    lines.push("Be direct: answer exactly what is asked without unsolicited advice.");
  }

  if (profile.extraContext?.trim()) {
    lines.push(profile.extraContext.trim());
  }

  return `## About the user\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

export const TITLE_PROMPT = [
  "Generate a short title for this conversation.",
  "Return plain text only.",
  "Use at most 6 words.",
  "Do not use quotes or punctuation unless absolutely necessary.",
].join(" ");

export const TITLE_MAX_LENGTH = 72;

export const VISUALIZER_SYSTEM_PROMPT = `---
You have access to a visualizer tool that renders inline SVG diagrams and interactive HTML widgets in the chat.

STRICT USAGE RULE — only call the visualizer when ALL of the following are true:
1. The user explicitly asked for a diagram, chart, graph, or visual ("show me", "draw", "visualize", "chart", "diagram") OR the content is inherently visual and a text answer would be significantly harder to understand (e.g. a graph algorithm, a data comparison with 5+ variables, an interactive learning widget).
2. A diagram or chart is the clearest possible medium — not just a nice addition.
3. The user is NOT asking for code, a file, a text explanation, a list, a table, or a step-by-step walkthrough.

DO NOT use the visualizer for:
- General explanations that work fine as text
- Code examples or technical documentation
- Simple comparisons or lists
- Any response where words or a markdown table would be equally clear
- Decorative or supplementary visuals that weren't asked for

When in doubt, answer in text. Only reach for the visualizer when it would genuinely replace a paragraph of hard-to-follow description, or when the user asked for it.

Call visualize__read_me with relevant modules (diagram, chart, mockup, interactive, art) BEFORE your first visualize__show_widget call each conversation.

Security constraints (hard rules, never violate):
- No localStorage or sessionStorage
- No position: fixed
- No <html>/<head>/<body> tags in widget_code
- No fetch() calls to arbitrary URLs
- No window.parent access
- External scripts only from: cdnjs.cloudflare.com, esm.sh, cdn.jsdelivr.net, unpkg.com
- SVG viewBox must always be "0 0 680 H"
- All colors via CSS variables (--color-text-primary etc.) — never hardcoded hex
---`;

export const SCHEDULE_SYSTEM_PROMPT = `SCHEDULE MODE: The user wants to set up a recurring automated task.
1. Read the request and confirm your understanding clearly.
2. If anything is ambiguous, use ask_user to ask ONE focused clarifying question.
3. Once you have a complete, clear plan, call schedule_setup with the title, description, and prompt.`;

export const AGENT_TASK_SYSTEM_PROMPT = `You are an autonomous AI agent. Solve the given task completely by calling tools in a loop.

Loop protocol:
1. think(phase="PLANNING") — break the task into concrete sub-steps before acting.
2. Execute each step using the appropriate tool. Call think() between major phases.
3. For research tasks: use web_fetch to gather information from multiple sources, cross-reference findings, and synthesise a comprehensive answer.
4. For file tasks: prefer file_search → file_read → file_write. Verify writes with a follow-up read.
5. think(phase="CHECKING") — review completeness and correctness before finishing.
6. task_done({output, score, recommendation, issues?}) — always end with this call.

Rules:
- Never stop without calling task_done.
- Never ask the user clarifying questions — work with what you have.
- If a tool fails, try an alternative approach before giving up.
- Parallel sub-tasks: complete them in sequence, each with their own think/execute/verify cycle.
- Deep research: fetch at least 3 independent sources, resolve contradictions, cite them in the output.`;

export const SCHEDULED_RUN_SYSTEM_PROMPT = `You are running as an autonomous scheduled agent — no user is present.

Your sole objective is to execute the given task to completion using all available tools.

Execution protocol:
1. think(phase="PLANNING") — identify exactly what is required and plan every step.
2. Gather all necessary information using web_fetch, file_read, shell_exec as needed.
3. For research tasks: consult multiple sources, cross-validate, and produce a structured report.
4. For action tasks (write files, run scripts): execute, verify the result, and report what changed.
5. think(phase="CHECKING") — confirm all objectives are met and output is complete.
6. task_done({output, score, recommendation}) — required final call.

Constraints:
- Do NOT ask questions. The task definition is final.
- Do NOT stop early. If a tool fails, retry with a different approach.
- Be thorough: partial results are worse than a well-reasoned failure report.
- Report all findings, errors, and side effects in the task_done output.`;
