/**
 * visualize__show_widget.skill.js
 *
 * Passthrough skill — the widget_code is validated and returned as-is.
 * The agent loop detects the "visualizer_widget" type and emits a dedicated
 * SSE event so the React client can render it in a sandboxed iframe.
 */

export default {
  name: "visualize__show_widget",

  description: `Renders a rich inline visual — SVG diagram or interactive HTML widget — directly in the chat window.

Use this tool proactively when a visual would genuinely aid understanding. Do NOT use for text responses, code, or when an Artifact/file was requested.

WHEN TO USE:
- Diagrams: flowcharts, architecture, data structures, system maps
- Charts: bar, line, pie (use Chart.js from cdnjs)
- Interactive widgets: sliders, calculators, step-through explainers
- Illustrative explainers: "how does X work", spatial metaphors for abstract concepts

WIDGET CODE RULES:
- SVG mode: content starts with <svg — use viewBox="0 0 680 H", width="100%"
- HTML mode: everything else — no <html>/<head>/<body> tags, just content fragments
- Use CSS variables for ALL colors (--color-text-primary, --color-background-secondary, etc.)
- Never use localStorage, sessionStorage, or position:fixed
- External scripts: ONLY from cdnjs.cloudflare.com, esm.sh, cdn.jsdelivr.net, unpkg.com
- sendPrompt(text) — global function, sends a message to chat as if user typed it
- openLink(url) — global function, opens link via host confirmation dialog
- Background must be transparent — host provides the card background`,

  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Short snake_case identifier, used as download filename. Must be specific: 'auth_flow_diagram' not 'diagram'.",
      },
      widget_code: {
        type: "string",
        description:
          'Raw SVG markup OR HTML fragment. SVG: start with <svg viewBox="0 0 680 H">. HTML: start directly with content, no doctype or html/head/body tags.',
      },
      loading_messages: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 4,
        description:
          "1–4 short messages shown while the widget renders (~5 words each). Be playful unless the topic is serious.",
      },
      i_have_seen_read_me: {
        type: "boolean",
        description:
          "Set to true after calling visualize__read_me at least once this conversation. Never skip the read_me call before your first widget.",
      },
    },
    required: ["title", "widget_code", "loading_messages", "i_have_seen_read_me"],
  },

  execute(input = {}) {
    const title = String(input.title ?? "widget").trim();
    const widget_code = String(input.widget_code ?? "").trim();
    const raw_loading = Array.isArray(input.loading_messages) ? input.loading_messages : [];
    const loading_messages = raw_loading
      .slice(0, 4)
      .map((m) => String(m).trim())
      .filter(Boolean);

    if (!widget_code) {
      return { error: "widget_code is required and must not be empty." };
    }

    return {
      type: "visualizer_widget",
      title,
      widget_code,
      loading_messages: loading_messages.length ? loading_messages : ["Rendering visual..."],
    };
  },
};
