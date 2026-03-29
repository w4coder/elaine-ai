/**
 * design-system.ts (client)
 * CSS variables and shared SVG classes injected into every visualizer iframe.
 */

export const CSS_VARIABLES_LIGHT = `
  --color-background-primary: #ffffff;
  --color-background-secondary: #f5f4ef;
  --color-background-tertiary: #efede6;
  --color-background-info: #e6f1fb;
  --color-background-danger: #fcebeb;
  --color-background-success: #eaf3de;
  --color-background-warning: #faeeda;

  --color-text-primary: #1a1a18;
  --color-text-secondary: #5f5e5a;
  --color-text-tertiary: #888780;
  --color-text-info: #185fa5;
  --color-text-danger: #a32d2d;
  --color-text-success: #3b6d11;
  --color-text-warning: #854f0b;

  --color-border-primary: rgba(0,0,0,0.4);
  --color-border-secondary: rgba(0,0,0,0.3);
  --color-border-tertiary: rgba(0,0,0,0.15);
  --color-border-info: rgba(24,95,165,0.4);
  --color-border-danger: rgba(163,45,45,0.4);
  --color-border-success: rgba(59,109,17,0.4);
  --color-border-warning: rgba(133,79,11,0.4);

  --font-sans: "Anthropic Sans", system-ui, sans-serif;
  --font-serif: Georgia, serif;
  --font-mono: "JetBrains Mono", monospace;

  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;

  --p: #1a1a18;
  --s: #5f5e5a;
  --t: rgba(0,0,0,0.3);
  --bg2: #f5f4ef;
  --b: rgba(0,0,0,0.15);
`;

export const CSS_VARIABLES_DARK = `
  --color-background-primary: #1a1a18;
  --color-background-secondary: #242421;
  --color-background-tertiary: #2c2c2a;
  --color-background-info: #042c53;
  --color-background-danger: #501313;
  --color-background-success: #173404;
  --color-background-warning: #412402;

  --color-text-primary: #e8e6de;
  --color-text-secondary: #b4b2a9;
  --color-text-tertiary: #888780;
  --color-text-info: #85b7eb;
  --color-text-danger: #f09595;
  --color-text-success: #97c459;
  --color-text-warning: #ef9f27;

  --color-border-primary: rgba(255,255,255,0.4);
  --color-border-secondary: rgba(255,255,255,0.3);
  --color-border-tertiary: rgba(255,255,255,0.15);
  --color-border-info: rgba(133,183,235,0.4);
  --color-border-danger: rgba(240,149,149,0.4);
  --color-border-success: rgba(151,196,89,0.4);
  --color-border-warning: rgba(239,159,39,0.4);

  --font-sans: "Anthropic Sans", system-ui, sans-serif;
  --font-serif: Georgia, serif;
  --font-mono: "JetBrains Mono", monospace;

  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;

  --p: #e8e6de;
  --s: #b4b2a9;
  --t: rgba(255,255,255,0.3);
  --bg2: #242421;
  --b: rgba(255,255,255,0.15);
`;

export const SHARED_CSS = `
/* Typography */
.t  { font-family: var(--font-sans); font-size: 14px; font-weight: 400; fill: var(--color-text-primary); }
.ts { font-family: var(--font-sans); font-size: 12px; font-weight: 400; fill: var(--color-text-secondary); }
.th { font-family: var(--font-sans); font-size: 14px; font-weight: 500; fill: var(--color-text-primary); }

/* Neutral box */
.box { fill: var(--color-background-secondary); stroke: var(--color-border-tertiary); }

/* Clickable node — hover dim */
.node { cursor: pointer; }
.node:hover { opacity: 0.8; }

/* Arrow line */
.arr { stroke: var(--color-border-secondary); stroke-width: 1.5; fill: none; }

/* Dashed leader */
.leader { stroke: var(--color-border-tertiary); stroke-width: 0.5; stroke-dasharray: 3 3; fill: none; }

/* Color ramps — light mode */
.c-purple { fill: #EEEDFE; stroke: #534AB7; }
.c-purple .t, .c-purple .th { fill: #3C3489; }
.c-purple .ts { fill: #534AB7; }

.c-teal { fill: #E1F5EE; stroke: #0F6E56; }
.c-teal .t, .c-teal .th { fill: #085041; }
.c-teal .ts { fill: #0F6E56; }

.c-coral { fill: #FAECE7; stroke: #993C1D; }
.c-coral .t, .c-coral .th { fill: #712B13; }
.c-coral .ts { fill: #993C1D; }

.c-pink { fill: #FBEAF0; stroke: #993556; }
.c-pink .t, .c-pink .th { fill: #72243E; }
.c-pink .ts { fill: #993556; }

.c-gray { fill: #F1EFE8; stroke: #5F5E5A; }
.c-gray .t, .c-gray .th { fill: #444441; }
.c-gray .ts { fill: #5F5E5A; }

.c-blue { fill: #E6F1FB; stroke: #185FA5; }
.c-blue .t, .c-blue .th { fill: #0C447C; }
.c-blue .ts { fill: #185FA5; }

.c-green { fill: #EAF3DE; stroke: #3B6D11; }
.c-green .t, .c-green .th { fill: #27500A; }
.c-green .ts { fill: #3B6D11; }

.c-amber { fill: #FAEEDA; stroke: #854F0B; }
.c-amber .t, .c-amber .th { fill: #633806; }
.c-amber .ts { fill: #854F0B; }

.c-red { fill: #FCEBEB; stroke: #A32D2D; }
.c-red .t, .c-red .th { fill: #791F1F; }
.c-red .ts { fill: #A32D2D; }

/* Dark mode overrides */
@media (prefers-color-scheme: dark) {
  .c-purple { fill: #3C3489; stroke: #AFA9EC; }
  .c-purple .t, .c-purple .th { fill: #CECBF6; }
  .c-purple .ts { fill: #AFA9EC; }

  .c-teal { fill: #085041; stroke: #5DCAA5; }
  .c-teal .t, .c-teal .th { fill: #9FE1CB; }
  .c-teal .ts { fill: #5DCAA5; }

  .c-coral { fill: #712B13; stroke: #F0997B; }
  .c-coral .t, .c-coral .th { fill: #F5C4B3; }
  .c-coral .ts { fill: #F0997B; }

  .c-pink { fill: #72243E; stroke: #ED93B1; }
  .c-pink .t, .c-pink .th { fill: #F4C0D1; }
  .c-pink .ts { fill: #ED93B1; }

  .c-gray { fill: #444441; stroke: #B4B2A9; }
  .c-gray .t, .c-gray .th { fill: #D3D1C7; }
  .c-gray .ts { fill: #B4B2A9; }

  .c-blue { fill: #0C447C; stroke: #85B7EB; }
  .c-blue .t, .c-blue .th { fill: #B5D4F4; }
  .c-blue .ts { fill: #85B7EB; }

  .c-green { fill: #27500A; stroke: #97C459; }
  .c-green .t, .c-green .th { fill: #C0DD97; }
  .c-green .ts { fill: #97C459; }

  .c-amber { fill: #633806; stroke: #EF9F27; }
  .c-amber .t, .c-amber .th { fill: #FAC775; }
  .c-amber .ts { fill: #EF9F27; }

  .c-red { fill: #791F1F; stroke: #F09595; }
  .c-red .t, .c-red .th { fill: #F7C1C1; }
  .c-red .ts { fill: #F09595; }
}
`;
