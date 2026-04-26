import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  // ── Global ignores ────────────────────────────────────────────────────────
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "eslint.config.mjs",
      "client/public/**",
      // Skill files are runtime plugin scripts injected by the agent loop, not linted source
      "server/src/skills/**",
    ],
  },

  // ── Base JS + TypeScript rules ────────────────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Server — Node.js environment ─────────────────────────────────────────
  {
    files: ["server/src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // ── Top-level scripts (install wizard etc.) — Node.js environment ───────
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // ── Client — Browser environment + React hooks ───────────────────────────
  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // ── Project-wide overrides ────────────────────────────────────────────────
  {
    rules: {
      // Warn on `any` — will be eliminated in a follow-up cleanup pass
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow _prefix convention for intentionally unused params/vars
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Prefer structured logging — warn until console calls are migrated
      "no-console": "warn",
    },
  },

  // ── Test files — allow console output ────────────────────────────────────
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/*.accuracy.test.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // ── Disable formatting rules (handled by Prettier) ────────────────────────
  prettierConfig
);
