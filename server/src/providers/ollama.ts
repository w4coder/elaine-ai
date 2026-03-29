import type { ProviderMessage, ProviderStreamChunk, ToolCall } from "../types.js";
import type { ProviderAdapter, StreamChatInput } from "./index.js";

function withBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Serialize ProviderMessage[] to Ollama's native /api/chat format.
 * Ollama uses a similar structure to OpenAI but without tool_call_id.
 */
function serializeMessages(messages: ProviderMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || "",
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.input },
        })),
      };
    }
    const base: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.images) base.images = m.images;
    return base;
  });
}

function toBody(input: StreamChatInput, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    stream,
    think: input.think,
    messages: serializeMessages(input.messages),
    options: {
      temperature: 0.2,
      ...(input.maxTokens !== undefined ? { num_predict: input.maxTokens } : {}),
    },
  };
  if (input.tools?.length) body.tools = input.tools;
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

function parseOllamaToolCalls(
  raw:
    | Array<{ function?: { name?: string; arguments?: Record<string, unknown> | string } }>
    | undefined
): ToolCall[] {
  if (!raw?.length) return [];
  return raw.map((tc, i) => {
    const args = tc.function?.arguments;
    let input: Record<string, unknown> = {};
    if (typeof args === "string") {
      try {
        input = JSON.parse(args) as Record<string, unknown>;
      } catch {
        /* keep empty */
      }
    } else if (args && typeof args === "object") {
      input = args;
    }
    return { id: `tool_${i}_${Date.now()}`, name: tc.function?.name ?? "", input };
  });
}

async function* parseJsonLines(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<{ content?: string; reasoning?: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inThinking = false;
  let reachedTerminalChunk = false;

  const parseLine = (
    line: string
  ): { chunk: { content?: string; reasoning?: string } | null; isTerminal: boolean } | null => {
    if (!line.trim()) {
      return null;
    }

    const json = JSON.parse(line) as {
      done?: boolean;
      message?: { content?: string; thinking?: string };
    };
    const content = json.message?.content ?? undefined;
    const reasoning = json.message?.thinking ?? undefined;

    if (reasoning) {
      inThinking = true;
    }

    if (content) {
      inThinking = false;
    }

    if (!reasoning && !content) {
      return {
        chunk: null,
        isTerminal: json.done === true,
      };
    }

    const chunk =
      inThinking && reasoning && !content
        ? { reasoning }
        : content && !reasoning
          ? { content }
          : { reasoning, content };

    return {
      chunk,
      isTerminal: json.done === true,
    };
  };

  const processLine = async function* (line: string) {
    const parsed = parseLine(line);
    if (!parsed) {
      return;
    }

    if (parsed.chunk?.reasoning || parsed.chunk?.content) {
      yield parsed.chunk;
    }

    if (parsed.isTerminal) {
      reachedTerminalChunk = true;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        for await (const chunk of processLine(line)) {
          yield chunk;
        }

        if (reachedTerminalChunk) {
          return;
        }
      }
    }

    if (buffer.trim()) {
      for await (const chunk of processLine(buffer)) {
        yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Streaming Ollama response, also detecting tool calls in the JSON lines.
 * Ollama sends complete tool call objects (not chunked like OpenAI), so we
 * can detect and emit them in one go.
 */
async function* parseJsonLinesWithTools(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<ProviderStreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inThinking = false;
  let reachedTerminalChunk = false;

  type OllamaStreamLine = {
    done?: boolean;
    message?: {
      content?: string;
      thinking?: string;
      tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>;
    };
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        const json = JSON.parse(line) as OllamaStreamLine;
        const msg = json.message;

        // Tool calls — emit as terminal chunk
        if (msg?.tool_calls?.length) {
          const toolCalls = parseOllamaToolCalls(msg.tool_calls);
          if (toolCalls.length) yield { toolCalls };
          reachedTerminalChunk = true;
          return;
        }

        const content = msg?.content ?? undefined;
        const reasoning = msg?.thinking ?? undefined;

        if (reasoning) inThinking = true;
        if (content) inThinking = false;

        if (reasoning || content) {
          const chunk =
            inThinking && reasoning && !content
              ? { reasoning }
              : content && !reasoning
                ? { content }
                : { reasoning, content };
          yield chunk;
        }

        if (json.done === true) {
          reachedTerminalChunk = true;
          return;
        }
      }

      if (reachedTerminalChunk) return;
    }

    if (buffer.trim()) {
      const json = JSON.parse(buffer) as OllamaStreamLine;
      if (json.message?.tool_calls?.length) {
        yield { toolCalls: parseOllamaToolCalls(json.message.tool_calls) };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const ollamaProvider: ProviderAdapter = {
  async listModels(profile) {
    const response = await fetch(`${withBase(profile.baseUrl)}/api/tags`);
    const data = await fetchJson<{ models?: Array<{ name: string }> }>(response);
    return (data.models ?? []).map((item) => item.name);
  },

  async *streamChat(input) {
    const response = await fetch(`${withBase(input.profile.baseUrl)}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toBody(input, true)),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        (await response.text()) || `Provider request failed with status ${response.status}`
      );
    }

    // Use tool-aware parser only when tools are configured
    if (input.tools?.length) {
      for await (const chunk of parseJsonLinesWithTools(response.body)) {
        yield chunk;
      }
    } else {
      for await (const chunk of parseJsonLines(response.body)) {
        yield chunk;
      }
    }
  },

  async completeChat(input) {
    const response = await fetch(`${withBase(input.profile.baseUrl)}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toBody(input, false)),
    });

    const data = await fetchJson<{
      message?: {
        content?: string;
        tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>;
      };
    }>(response);

    return {
      content: data.message?.content?.trim() ?? "",
      toolCalls: parseOllamaToolCalls(data.message?.tool_calls),
    };
  },
};
