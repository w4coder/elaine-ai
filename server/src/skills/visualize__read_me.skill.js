/**
 * visualize__read_me.skill.js
 *
 * Returns design guidelines for the visualizer tool.
 * The LLM must call this before its first visualize__show_widget call.
 */

const COLOR_RAMPS = {
  purple: {
    50: "#EEEDFE",
    100: "#CECBF6",
    200: "#AFA9EC",
    400: "#7F77DD",
    600: "#534AB7",
    800: "#3C3489",
    900: "#26215C",
  },
  teal: {
    50: "#E1F5EE",
    100: "#9FE1CB",
    200: "#5DCAA5",
    400: "#1D9E75",
    600: "#0F6E56",
    800: "#085041",
    900: "#04342C",
  },
  coral: {
    50: "#FAECE7",
    100: "#F5C4B3",
    200: "#F0997B",
    400: "#D85A30",
    600: "#993C1D",
    800: "#712B13",
    900: "#4A1B0C",
  },
  pink: {
    50: "#FBEAF0",
    100: "#F4C0D1",
    200: "#ED93B1",
    400: "#D4537E",
    600: "#993556",
    800: "#72243E",
    900: "#4B1528",
  },
  gray: {
    50: "#F1EFE8",
    100: "#D3D1C7",
    200: "#B4B2A9",
    400: "#888780",
    600: "#5F5E5A",
    800: "#444441",
    900: "#2C2C2A",
  },
  blue: {
    50: "#E6F1FB",
    100: "#B5D4F4",
    200: "#85B7EB",
    400: "#378ADD",
    600: "#185FA5",
    800: "#0C447C",
    900: "#042C53",
  },
  green: {
    50: "#EAF3DE",
    100: "#C0DD97",
    200: "#97C459",
    400: "#639922",
    600: "#3B6D11",
    800: "#27500A",
    900: "#173404",
  },
  amber: {
    50: "#FAEEDA",
    100: "#FAC775",
    200: "#EF9F27",
    400: "#BA7517",
    600: "#854F0B",
    800: "#633806",
    900: "#412402",
  },
  red: {
    50: "#FCEBEB",
    100: "#F7C1C1",
    200: "#F09595",
    400: "#E24B4A",
    600: "#A32D2D",
    800: "#791F1F",
    900: "#501313",
  },
};

const ALLOWED_CDN_ORIGINS = [
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
];

function buildCoreSection() {
  // Kept intentionally compact — small models struggle with large tool results.
  // The color ramp table is omitted; .c-{name} classes are sufficient for the model.
  return `# Visualizer Design System

## CSS Variables (use for ALL colors — never hardcode hex)
Text: --color-text-primary, --color-text-secondary, --color-text-tertiary
Backgrounds: --color-background-primary, --color-background-secondary, --color-background-tertiary
Borders: --color-border-primary, --color-border-secondary, --color-border-tertiary
Semantic: --color-text-info/danger/success/warning, --color-background-info/danger/success/warning
Typography: --font-sans, --font-mono
Layout: --border-radius-md (8px), --border-radius-lg (12px)

## SVG Classes
.t = 14px text primary | .ts = 12px text secondary | .th = 14px medium text primary
.box = neutral rect | .arr = arrow line | .node = clickable group (hover dim)
.c-blue .c-green .c-red .c-amber .c-purple .c-teal .c-coral .c-pink .c-gray — colored nodes, auto dark mode

## Global Functions
sendPrompt(text) — submits text to chat | openLink(url) — opens link with confirmation

## Hard Rules
- SVG: viewBox="0 0 680 H" (H = total height), width="100%"
- No <html>/<head>/<body> tags in widget_code
- Background must be transparent
- No localStorage/sessionStorage, no position:fixed
- External scripts only from: ${ALLOWED_CDN_ORIGINS.join(", ")}

## Arrow Marker
<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`;
}

const MODULE_DOCS = {
  diagram: `## Module: diagram
SVG flowchart. Use viewBox="0 0 680 H". Safe area x=40..640, y=40..(H-40).
Nodes: <rect rx="8" height="44"> + <text class="th" dominant-baseline="central">
Clickable: <g class="node c-blue" onclick="sendPrompt('...')">
Route arrows with L-bend paths. viewBox height = bottommost element + 40px.`,

  chart: `## Module: chart
Use Chart.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
Canvas: <canvas id="chart" style="max-height:300px">
Read colors at render time: getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary')
Chart background: transparent.`,

  mockup: `## Module: mockup
HTML + CSS variables. Card: background:var(--color-background-secondary); border-radius:var(--border-radius-lg); padding:16px
Button: background:var(--color-text-primary); color:var(--color-background-primary)
No position:fixed. Normal document flow only.`,

  interactive: `## Module: interactive
HTML + vanilla JS. State in JS variables — no localStorage.
Controls: <input type="range">, <input type="checkbox">, <button>
Use sendPrompt(text) for chat follow-up. Scripts at end of body or DOMContentLoaded.`,

  art: `## Module: art
SVG illustration. Paths, circles, ellipses, polygons — no raster images.
One linearGradient permitted (two stops, same ramp).
Animations: @keyframes on transform/opacity only, wrapped in @media (prefers-reduced-motion: no-preference).`,
};

export default {
  name: "visualize__read_me",

  description:
    "Load design guidelines for the visualizer. Call this before your first visualize__show_widget call each conversation. Pick all relevant modules.",

  input_schema: {
    type: "object",
    properties: {
      modules: {
        type: "array",
        items: {
          type: "string",
          enum: ["diagram", "mockup", "interactive", "chart", "art"],
        },
        description: "Which design modules to load: diagram, mockup, interactive, chart, art",
      },
    },
    required: ["modules"],
  },

  execute(input = {}) {
    const modules = Array.isArray(input.modules) ? input.modules : [];
    const sections = [buildCoreSection()];
    for (const mod of modules) {
      if (MODULE_DOCS[mod]) {
        sections.push(MODULE_DOCS[mod]);
      }
    }
    return sections.join("\n\n---\n\n");
  },
};
