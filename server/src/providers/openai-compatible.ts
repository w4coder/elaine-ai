import type {
  ProviderMessage,
  ProviderProfile,
  ProviderStreamChunk,
  ToolCall,
  ToolDefinition,
} from "../types.js";
import type { CompleteChatResult, ProviderAdapter, StreamChatInput } from "./index.js";

function withV1(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function enrichFetchError(err: unknown, baseUrl: string): Error {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === "ECONNREFUSED") {
    return new Error(`Connection refused at ${baseUrl} — is the provider running?`);
  }
  if (cause?.code === "ENOTFOUND") {
    return new Error(`Host not found: ${baseUrl} — check the URL.`);
  }
  if (cause?.code === "ECONNRESET") {
    return new Error(`Connection reset by ${baseUrl}.`);
  }
  if (err instanceof Error && err.message === "fetch failed") {
    const detail = cause?.message ? `: ${cause.message}` : "";
    return new Error(`Could not reach ${baseUrl}${detail} — check the URL, network, and API key.`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

function buildHeaders(profile: ProviderProfile): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (profile.apiKey?.trim()) {
    headers.Authorization = `Bearer ${profile.apiKey.trim()}`;
  }

  return headers;
}

/**
 * Serialize ProviderMessage[] to the format OpenAI's /chat/completions expects.
 * - Tool-result messages get role:"tool" with tool_call_id
 * - Assistant messages with tool calls get the tool_calls array
 * - Everything else passes through unchanged (preserves existing image handling)
 */
function serializeMessages(messages: ProviderMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        })),
      };
    }
    const base: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.images) base.images = m.images;
    return base;
  });
}

function toBody(input: StreamChatInput, stream: boolean): Record<string, unknown> {
  // deepseek-reasoner does not accept temperature/top_p — omit for all *-reasoner models
  const isReasoningModel = /reasoner/i.test(input.model);
  const body: Record<string, unknown> = {
    model: input.model,
    messages: serializeMessages(input.messages),
    stream,
    ...(isReasoningModel ? {} : { temperature: 0.2 }),
  };
  if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;
  if (input.tools?.length) {
    body.tools = input.tools;
    body.tool_choice = "auto";
  }
  return body;
}

async function fetchJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(
      (await response.text()) || `Provider request failed with status ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

interface ToolCallAcc {
  id: string;
  name: string;
  arguments: string;
}

async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<ProviderStreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallsAcc = new Map<number, ToolCallAcc>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data:"));

        for (const line of lines) {
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          const json = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning_content?: string;
                reasoning?: string | Array<{ text?: string; content?: string }>;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
          };

          const choice = json.choices?.[0];
          const delta = choice?.delta;

          // Accumulate tool call chunks
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsAcc.has(idx)) {
                toolCallsAcc.set(idx, { id: "", name: "", arguments: "" });
              }
              const acc = toolCallsAcc.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            }
          }

          // Yield content / reasoning chunks
          const reasoning = Array.isArray(delta?.reasoning)
            ? delta.reasoning.map((e) => e.text ?? e.content ?? "").join("")
            : (delta?.reasoning ?? "");
          const chunk: ProviderStreamChunk = {
            reasoning: `${delta?.reasoning_content ?? ""}${reasoning}` || undefined,
            content: delta?.content ?? undefined,
          };
          if (chunk.reasoning || chunk.content) yield chunk;

          // Emit accumulated tool calls when the model signals it's done calling tools
          if (choice?.finish_reason === "tool_calls" && toolCallsAcc.size > 0) {
            const toolCalls: ToolCall[] = [...toolCallsAcc.entries()]
              .sort(([a], [b]) => a - b)
              .map(([i, tc]) => {
                let input: Record<string, unknown> = {};
                try {
                  input = JSON.parse(tc.arguments || "{}") as Record<string, unknown>;
                } catch {
                  /* keep empty */
                }
                return { id: tc.id || `tool_${i}`, name: tc.name, input };
              });
            yield { toolCalls };
            toolCallsAcc.clear();
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseOpenAIToolCalls(
  raw: Array<{ id?: string; function?: { name?: string; arguments?: string } }> | undefined
): ToolCall[] {
  if (!raw?.length) return [];
  return raw.map((tc, i) => {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    return { id: tc.id ?? `tool_${i}`, name: tc.function?.name ?? "", input };
  });
}

export const openAiCompatibleProvider: ProviderAdapter = {
  async listModels(profile) {
    const response = await fetch(`${withV1(profile.baseUrl)}/models`, {
      headers: buildHeaders(profile),
    });

    const data = await fetchJson<{ data?: Array<{ id: string }> }>(response);
    return (data.data ?? []).map((item) => item.id);
  },

  async *streamChat(input) {
    let response: Response;
    try {
      response = await fetch(`${withV1(input.profile.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: buildHeaders(input.profile),
        body: JSON.stringify(toBody(input, true)),
      });
    } catch (err) {
      throw enrichFetchError(err, input.profile.baseUrl);
    }

    if (!response.ok || !response.body) {
      throw new Error(
        (await response.text()) || `Provider request failed with status ${response.status}`
      );
    }

    for await (const chunk of parseSse(response.body)) {
      yield chunk;
    }
  },

  async completeChat(input) {
    let response: Response;
    try {
      response = await fetch(`${withV1(input.profile.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: buildHeaders(input.profile),
        body: JSON.stringify(toBody(input, false)),
      });
    } catch (err) {
      throw enrichFetchError(err, input.profile.baseUrl);
    }

    const data = await fetchJson<{
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    }>(response);

    const message = data.choices?.[0]?.message;
    return {
      content: message?.content?.trim() ?? "",
      toolCalls: parseOpenAIToolCalls(message?.tool_calls),
    };
  },
};
