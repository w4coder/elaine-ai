/**
 * agentLoop.ts
 *
 * Unified streaming agent loop for both chat and task intents.
 * Wraps the provider's streamChat in a multi-turn loop that:
 *   1. Streams model output to the caller in real time.
 *   2. When the model emits tool calls, executes each skill and feeds results
 *      back as a new turn — emitting reasoning delta events throughout.
 *   3. Continues until the model produces a response with no tool calls,
 *      task_done is called, or maxIterations is reached.
 *
 * From the caller's perspective this is just an AsyncGenerator<ProviderStreamChunk>
 * — identical to a direct streamChat call.  The handler needs no changes.
 */

import type {
  ProviderMessage,
  ProviderStreamChunk,
  ToolCall,
  ToolDefinition,
  AskUserQuestion,
  VisualizerWidget,
} from "../types.js";
import type { ProviderAdapter } from "../providers/index.js";
import { executeSkill } from "../skills/skillRegistry.js";
import { logToolCall } from "./auditLog.js";
import { isSkillAllowed, getSkillCapability, consumeOnceGrant } from "./skillPermissions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentLoopOptions {
  adapter: ProviderAdapter;
  profile: import("../types.js").ProviderProfile;
  model: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
  think?: boolean | "low" | "medium" | "high";
  /** "chat" uses a conservative cap; "task" allows more steps; "scheduled" is fully autonomous with the highest cap. */
  mode: "chat" | "task" | "scheduled";
  /** Optional execution context forwarded to skill execute() calls. */
  skillContext?: Record<string, unknown>;
  /** When true, execute tools without pausing for permission prompts. */
  autoApproveTools?: boolean;
  /** When false, omit the trailing tool recap tags from the final response. */
  includeToolTags?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_ITERATIONS: Record<"chat" | "task" | "scheduled", number> = {
  chat: 5,
  task: 30,
  scheduled: 50,
};

function abbreviate(s: string, max = 400): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

async function* streamReasoning(text: string): AsyncGenerator<ProviderStreamChunk> {
  for (let i = 0; i < text.length; i += 4) {
    yield { reasoning: text.slice(i, i + 4) };
  }
}

function formatToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "think":
      return `\n💭 ${abbreviate(String(input.thought ?? ""), 300)}\n`;
    case "file_write":
      return `\n📝 Writing \`${input.path}\`\n`;
    case "file_read":
      return `\n📖 Reading \`${input.path}\`\n`;
    case "file_search":
      return `\n🔍 Searching \`${input.pattern ?? "*"}\`${input.path ? ` in \`${input.path}\`` : ""}\n`;
    case "web_fetch":
      return `\n🌐 Fetching ${input.url}\n`;
    case "shell_exec":
      return `\n⚡ Running: \`${abbreviate(String(input.command ?? ""), 120)}\`\n`;
    case "visualize__read_me":
      return `\n🎨 Loading visualizer design guidelines\n`;
    case "visualize__show_widget":
      return `\n🖼 Rendering widget: "${abbreviate(String(input.title ?? ""), 60)}"\n`;
    case "schedule_setup":
      return `\n📅 Schedule ready: "${abbreviate(String(input.title ?? ""), 60)}"\n`;
    default:
      return `\n→ **${name}**(${Object.keys(input).join(", ")})\n`;
  }
}

function formatToolResult(name: string, result: unknown): string {
  if (typeof result === "object" && result !== null && "error" in result) {
    return `  ✗ ${abbreviate(String((result as Record<string, unknown>).error), 200)}\n`;
  }
  const r = result as Record<string, unknown>;
  switch (name) {
    case "think":
      return "";
    case "visualize__read_me":
      return `  ✓ Design guidelines loaded\n`;
    case "visualize__show_widget": {
      const title = typeof r.title === "string" ? r.title : "";
      return r.type === "visualizer_widget"
        ? `  ✓ Widget rendered: "${abbreviate(title, 60)}"\n`
        : `  ✗ Widget render failed\n`;
    }
    case "schedule_setup":
      return r.scheduleReady
        ? `  ✓ Schedule configured: "${abbreviate(String(r.title ?? ""), 60)}"\n`
        : `  ✗ ${r.error}\n`;
    case "file_write":
      return r.written ? `  ✓ Saved to \`${r.path}\`\n` : `  ✗ Write failed\n`;
    case "file_read":
      return typeof r.content === "string"
        ? `  ✓ Read ${r.content.length} chars\n`
        : `  ✗ Read failed\n`;
    case "file_search":
      return Array.isArray(r.files)
        ? `  ✓ Found ${(r.files as unknown[]).length} file(s)\n`
        : `  ✗ Search failed\n`;
    case "web_fetch":
      return typeof r.content === "string"
        ? `  ✓ Fetched ${r.content.length} chars\n`
        : `  ✗ Fetch failed\n`;
    case "shell_exec": {
      const exit = r.exitCode ?? r.exit_code;
      const out = abbreviate(String(r.stdout ?? r.output ?? ""), 200).trim();
      const err = abbreviate(String(r.stderr ?? ""), 100).trim();
      const status = exit === 0 || exit === undefined ? "✓" : `✗ (exit ${exit})`;
      const preview = out || err ? `\n  ${(out || err).replace(/\n/g, "\n  ")}` : "";
      return `  ${status}${preview}\n`;
    }
    default:
      return `  ← ${abbreviate(JSON.stringify(result), 200)}\n`;
  }
}

function buildFooter(
  fetchedUrls: string[],
  fileLinks: () => string,
  toolTags: () => string
): string {
  const deduped = [...new Set(fetchedUrls)];
  const sources =
    deduped.length > 0
      ? "\n\n---\n**Sources**\n" + deduped.map((u, i) => `${i + 1}. <${u}>`).join("\n")
      : "";
  return sources + fileLinks() + toolTags();
}

function buildFallbackAnswer(messages: ProviderMessage[]): string {
  const recentToolOutputs = messages
    .filter((message) => message.role === "tool" && message.content.trim())
    .slice(-3)
    .map((message) => abbreviate(message.content.replace(/\s+/g, " ").trim(), 280));

  const recentAssistantText = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim())?.content;

  if (recentAssistantText?.trim()) {
    return recentAssistantText.trim();
  }

  if (recentToolOutputs.length > 0) {
    return (
      "I couldn’t complete every step, but here’s the best answer I can give from what I gathered so far:\n\n" +
      recentToolOutputs.map((output, index) => `${index + 1}. ${output}`).join("\n")
    );
  }

  return "I couldn’t finish every step, but I don’t want to stop empty-handed. Please retry or narrow the request and I’ll continue from there.";
}

async function synthesizeFinalAnswer(params: {
  adapter: ProviderAdapter;
  profile: import("../types.js").ProviderProfile;
  model: string;
  messages: ProviderMessage[];
}): Promise<string> {
  const synthesisPrompt: ProviderMessage = {
    role: "user",
    content:
      "No more tool calls are available. Based only on the conversation and tool outputs already gathered, give the best possible final answer now. " +
      "Do not mention tool limits unless truly necessary. If something remains uncertain, say so briefly and answer with the most useful partial result.",
  };

  const result = await params.adapter.completeChat({
    profile: params.profile,
    model: params.model,
    messages: [...params.messages, synthesisPrompt],
    think: false,
    maxTokens: 1200,
  });

  return result.content.trim();
}

// ---------------------------------------------------------------------------
// Core loop
// ---------------------------------------------------------------------------

/**
 * Run the agent loop and yield ProviderStreamChunk objects.
 *
 * Content and reasoning chunks are forwarded immediately as they arrive from
 * the provider.  Tool call chunks trigger skill execution and are converted
 * into reasoning events before the loop continues.
 */
export async function* runAgentStream(
  options: AgentLoopOptions
): AsyncGenerator<ProviderStreamChunk> {
  const {
    adapter,
    profile,
    model,
    tools,
    mode,
    skillContext = {},
    autoApproveTools = false,
    includeToolTags = true,
  } = options;

  // Work on a mutable copy so we can append tool messages each turn
  const messages: ProviderMessage[] = [...options.messages];
  const max = MAX_ITERATIONS[mode];

  // Collect URLs fetched via web_fetch across all iterations
  const fetchedUrls: string[] = [];

  // Track which non-internal tools were invoked (for the footer tags)
  const INTERNAL_TOOLS = new Set([
    "think",
    "task_done",
    "ask_user",
    "schedule_setup",
    "visualize__read_me",
    "visualize__show_widget",
  ]);
  const usedTools: Set<string> = new Set();

  // Track files written by file_write across all iterations (path → name)
  const writtenFiles: Array<{ path: string; name: string }> = [];

  function toolTags(): string {
    if (!includeToolTags) return "";
    if (usedTools.size === 0) return "";
    return "\n\n" + [...usedTools].map((t) => `\`${t}\``).join(" ");
  }

  function fileLinks(): string {
    if (writtenFiles.length === 0) return "";
    return "\n\n" + writtenFiles.map((f) => `[📄 ${f.name}](file://${f.path})`).join("  ");
  }

  for (let iteration = 1; iteration <= max; iteration++) {
    // ------------------------------------------------------------------
    // Stream one turn
    // ------------------------------------------------------------------
    const turnContent: string[] = [];
    let turnToolCalls: ToolCall[] = [];

    // Disable model-level thinking inside the agent loop: qwen3 and similar
    // models generate tool calls inside their reasoning block when think=true,
    // which Ollama returns as chunk.reasoning (not as structured tool_calls),
    // causing the loop to silently exit.  The explicit `think` tool handles
    // planning steps instead.
    const stream = adapter.streamChat({ profile, model, messages, tools, think: false });

    for await (const chunk of stream) {
      if (chunk.toolCalls) {
        // Terminal chunk carrying accumulated tool calls — don't yield to client
        turnToolCalls = chunk.toolCalls;
      } else {
        // Regular content / reasoning — forward immediately
        if (chunk.content) turnContent.push(chunk.content);
        yield chunk;
      }
    }

    // ------------------------------------------------------------------
    // No tool calls → model is done; emit sources + files + tags then exit
    // ------------------------------------------------------------------
    if (turnToolCalls.length === 0) {
      // If the model produced nothing at all (empty content, no tool calls) after
      // at least one tool turn, surface a diagnostic so the user isn't left with
      // a blank response and no indication of what happened.
      if (iteration > 1 && turnContent.join("").trim() === "") {
        yield {
          reasoning:
            "\n⚠ Model returned an empty response after tool execution. The model may not have followed through on the expected tool call (e.g. visualize__show_widget). Try a larger model or simplify the request.\n",
        };
      }
      const footer = buildFooter(fetchedUrls, fileLinks, toolTags);
      if (footer) yield { content: footer };
      return;
    }

    // ------------------------------------------------------------------
    // Tool calls present — append assistant turn to history
    // ------------------------------------------------------------------
    const assistantContent = turnContent.join("");
    messages.push({
      role: "assistant",
      content: assistantContent,
      toolCalls: turnToolCalls,
    });

    // ------------------------------------------------------------------
    // Execute each tool and collect results
    // ------------------------------------------------------------------
    let earlyExit = false;

    for (const toolCall of turnToolCalls) {
      // Show the call in the thinking panel (streamed, human-readable)
      yield* streamReasoning(
        formatToolCall(toolCall.name, toolCall.input as Record<string, unknown>)
      );

      // Show skeleton only when the widget is actually being generated
      if (toolCall.name === "visualize__show_widget") {
        yield {
          widgetLoading: true,
          widgetTitle: String((toolCall.input as Record<string, unknown>).title ?? ""),
        };
      }

      // ── Permission check ──────────────────────────────────────────────────
      const convId =
        typeof skillContext.conversationId === "string" ? skillContext.conversationId : null;
      if (
        !autoApproveTools &&
        !isSkillAllowed({ skillName: toolCall.name, agentMode: mode, conversationId: convId })
      ) {
        const capability = getSkillCapability(toolCall.name);
        yield {
          permissionRequired: { skillName: toolCall.name, capability, conversationId: convId! },
        };
        // Inject a tool result so the model history stays consistent
        messages.push({
          role: "tool",
          content: JSON.stringify({ permissionDenied: true, capability }),
          toolCallId: toolCall.id,
        });
        earlyExit = true;
        break;
      }

      let result: unknown;
      const t0 = Date.now();
      let skillSuccess = true;
      try {
        result = await executeSkill(toolCall.name, toolCall.input, skillContext);
        if (typeof result === "object" && result !== null && "error" in result)
          skillSuccess = false;
      } catch (err) {
        result = { error: err instanceof Error ? err.message : "Skill execution failed" };
        skillSuccess = false;
      }
      // Consume "once" grants immediately after the tool runs
      if (convId) {
        consumeOnceGrant(convId, getSkillCapability(toolCall.name));
      }
      logToolCall({
        conversationId:
          typeof skillContext.conversationId === "string" ? skillContext.conversationId : null,
        agentMode: mode,
        skillName: toolCall.name,
        input: toolCall.input,
        result,
        success: skillSuccess,
        durationMs: Date.now() - t0,
      });

      const resultStr = JSON.stringify(result, null, 2);
      yield* streamReasoning(formatToolResult(toolCall.name, result));

      // Track URLs fetched via web_fetch
      if (toolCall.name === "web_fetch" && typeof toolCall.input.url === "string") {
        fetchedUrls.push(toolCall.input.url);
      }

      // Track non-internal tools for footer tags
      if (!INTERNAL_TOOLS.has(toolCall.name)) {
        usedTools.add(toolCall.name);
      }

      // Track files written by file_write
      if (toolCall.name === "file_write") {
        const fr = result as { written?: boolean; path?: string };
        if (fr.written && typeof fr.path === "string") {
          writtenFiles.push({ path: fr.path, name: fr.path.split("/").pop() ?? fr.path });
        }
      }

      // task_done is a special sentinel — output is in the model's input args
      if (toolCall.name === "task_done") {
        const output =
          typeof toolCall.input.output === "string" ? toolCall.input.output : undefined;
        if (output) {
          // Stream the output in small chunks for progressive rendering
          for (let i = 0; i < output.length; i += 4) {
            yield { content: output.slice(i, i + 4) };
          }
        }
        const footer = buildFooter(fetchedUrls, fileLinks, toolTags);
        if (footer) yield { content: footer };
        earlyExit = true;
        break;
      }

      // visualize__read_me failure — remove the skeleton
      if (toolCall.name === "visualize__read_me") {
        const rr = result as Record<string, unknown>;
        if (rr.error) {
          yield { widgetFailed: true };
        }
      }

      // visualize__show_widget — emit the widget chunk without stopping the loop
      if (toolCall.name === "visualize__show_widget") {
        const wr = result as Record<string, unknown>;
        if (wr.type === "visualizer_widget") {
          yield {
            widget: {
              type: "visualizer_widget",
              title: String(wr.title ?? ""),
              widget_code: String(wr.widget_code ?? ""),
              loading_messages: Array.isArray(wr.loading_messages)
                ? (wr.loading_messages as string[])
                : ["Rendering visual..."],
            } satisfies VisualizerWidget,
          };
        } else {
          // Skill returned an error or invalid result — remove the skeleton
          yield { widgetFailed: true };
        }
        // Fall through to messages.push below — loop continues normally
      }

      // ask_user — emit questions as content (persisted to DB) then as widget chunk
      if (toolCall.name === "ask_user") {
        const askResult = result as { questions?: AskUserQuestion[]; error?: string };
        if (askResult.questions?.length) {
          const lines = askResult.questions
            .map((q, i) => {
              const opts = q.suggestions?.length
                ? "\n" + q.suggestions.map((s) => `   - ${s}`).join("\n")
                : "";
              return `${i + 1}. ${q.question}${opts}`;
            })
            .join("\n\n");
          yield { content: `I have a few questions before I continue:\n\n${lines}` };
          yield { questions: askResult.questions };
        }
        earlyExit = true;
        break;
      }

      // schedule_setup — emit schedule ready payload then exit loop
      if (toolCall.name === "schedule_setup") {
        const sr = result as {
          scheduleReady?: boolean;
          title?: string;
          description?: string;
          prompt?: string;
          error?: string;
        };
        if (sr.scheduleReady) {
          yield {
            scheduleReady: { title: sr.title!, description: sr.description!, prompt: sr.prompt! },
          };
        }
        earlyExit = true;
        break;
      }

      // Append tool result message for the next turn
      messages.push({
        role: "tool",
        content: resultStr,
        toolCallId: toolCall.id,
      });
    }

    if (earlyExit) return;

    // Yield a context-aware marker so the UI shows activity while the next
    // LLM call is in-flight (before the model starts streaming tokens).
    const lastToolName = turnToolCalls[turnToolCalls.length - 1]?.name ?? "";
    const nextStepLabel =
      lastToolName === "visualize__read_me" ? "⟳ Generating visualization..." : "⟳ Continuing...";
    yield { reasoning: `\n${nextStepLabel}\n` };
  }

  // Exhausted max iterations: force a final answer from gathered context instead
  let finalAnswer = "";
  try {
    finalAnswer = await synthesizeFinalAnswer({ adapter, profile, model, messages });
  } catch {
    finalAnswer = "";
  }

  if (!finalAnswer) {
    finalAnswer = buildFallbackAnswer(messages);
  }

  yield { content: finalAnswer + buildFooter(fetchedUrls, fileLinks, toolTags) };
}
