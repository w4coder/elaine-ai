/**
 * intentClassifier.accuracy.test.ts
 *
 * Real-model accuracy benchmark for the intent classifier.
 * Runs a curated prompt list against a live Ollama instance and prints
 * a detailed pass/fail report with per-category breakdown.
 *
 * Requirements:
 *   - Ollama running at http://127.0.0.1:11434
 *   - Model pulled: ollama pull qwen3:1.7b   (or change MODEL below)
 *
 * Run:
 *   node --import tsx/esm src/classifier/intentClassifier.accuracy.test.ts
 */

import { classifyIntent } from "./intentClassifier.js";
import type { ClassifierConfig } from "./intentClassifier.js";
import type { ProviderProfile } from "../types.js";

// ─── Configuration ────────────────────────────────────────────────────────────
//
// Override via environment variables:
//   CLASSIFIER_TEST_MODEL       e.g. "deepseek-chat" or "deepseek-reasoner"
//   CLASSIFIER_TEST_PROVIDER    "ollama" | "openai"  (default: "ollama")
//   CLASSIFIER_TEST_BASE_URL    e.g. "https://api.deepseek.com"
//   CLASSIFIER_TEST_API_KEY     API key if required
//   CLASSIFIER_TEST_CONCURRENCY number of parallel calls (default: 3)

const MODEL = process.env.CLASSIFIER_TEST_MODEL ?? "qwen3.5:latest";
const PROVIDER_TYPE = (process.env.CLASSIFIER_TEST_PROVIDER ?? "ollama") as "ollama" | "openai";
const BASE_URL = process.env.CLASSIFIER_TEST_BASE_URL ?? "http://127.0.0.1:11434";
const API_KEY = process.env.CLASSIFIER_TEST_API_KEY;

const CONFIDENCE_THRESHOLD = 0.6;
const CONCURRENCY = parseInt(process.env.CLASSIFIER_TEST_CONCURRENCY ?? "3", 10);
const PASS_THRESHOLD = 0.75; // overall accuracy to exit 0

const PROFILE: ProviderProfile = {
  id: "classifier-test",
  name: `${PROVIDER_TYPE} / ${MODEL}`,
  providerType: PROVIDER_TYPE,
  baseUrl: BASE_URL,
  apiKey: API_KEY,
  enabled: true,
};

const CONFIG: ClassifierConfig = {
  enabled: true,
  confidenceThreshold: CONFIDENCE_THRESHOLD,
};

// ─── Test Cases ───────────────────────────────────────────────────────────────

interface Case {
  prompt: string;
  expected: "chat" | "task";
  category: string;
}

const CASES: Case[] = [
  // ── Clear CHAT ──────────────────────────────────────────────────────────────
  {
    category: "chat · question",
    expected: "chat",
    prompt: "What is the difference between TCP and UDP?",
  },
  {
    category: "chat · question",
    expected: "chat",
    prompt: "How does garbage collection work in Java?",
  },
  { category: "chat · question", expected: "chat", prompt: "What is the capital of France?" },
  {
    category: "chat · explain",
    expected: "chat",
    prompt: "Explain how promises work in JavaScript.",
  },
  {
    category: "chat · explain",
    expected: "chat",
    prompt: "Can you explain what a neural network is?",
  },
  { category: "chat · explain", expected: "chat", prompt: "How does HTTPS work under the hood?" },
  {
    category: "chat · opinion",
    expected: "chat",
    prompt: "What do you think about using Rust for backend development?",
  },
  { category: "chat · casual", expected: "chat", prompt: "Hey, what's up?" },
  { category: "chat · casual", expected: "chat", prompt: "Good morning!" },
  {
    category: "chat · review",
    expected: "chat",
    prompt: "Review this function: function add(a, b) { return a + b; }",
  },
  {
    category: "chat · debug",
    expected: "chat",
    prompt: "What could cause a CORS error in a React app?",
  },
  { category: "chat · debug", expected: "chat", prompt: "Why is my for loop printing undefined?" },
  {
    category: "chat · compare",
    expected: "chat",
    prompt: "What are the pros and cons of PostgreSQL vs MongoDB?",
  },
  { category: "chat · definition", expected: "chat", prompt: "What is a monad?" },
  { category: "chat · howto", expected: "chat", prompt: "How do I center a div in CSS?" },
  {
    category: "chat · howto",
    expected: "chat",
    prompt: "What's the best way to handle auth in a REST API?",
  },
  {
    category: "chat · troubleshoot",
    expected: "chat",
    prompt: "My build is failing with 'module not found'. What should I check?",
  },
  {
    category: "chat · code-help",
    expected: "chat",
    prompt: "What does the spread operator do in JavaScript?",
  },

  // ── Clear TASK ──────────────────────────────────────────────────────────────
  {
    category: "task · create",
    expected: "task",
    prompt: "Create a new file called README.md with project setup instructions.",
  },
  {
    category: "task · run",
    expected: "task",
    prompt: "Run the tests and fix any that are failing.",
  },
  {
    category: "task · refactor",
    expected: "task",
    prompt: "Refactor the auth module to use JWT instead of sessions.",
  },
  {
    category: "task · setup",
    expected: "task",
    prompt: "Set up a CI/CD pipeline for this project.",
  },
  {
    category: "task · search+fix",
    expected: "task",
    prompt: "Find all files that import from the old API and update them to the new endpoint.",
  },
  {
    category: "task · write",
    expected: "task",
    prompt:
      "Write a Python script that scrapes product prices from amazon.com and saves them to a CSV.",
  },
  {
    category: "task · analyze",
    expected: "task",
    prompt: "Analyze the logs in /var/log/app.log and summarize the errors from the last 24 hours.",
  },
  {
    category: "task · deploy",
    expected: "task",
    prompt: "Deploy the latest build to the staging server.",
  },
  {
    category: "task · research",
    expected: "task",
    prompt: "Research the top 5 open-source LLM frameworks and compare them in a table.",
  },
  {
    category: "task · generate",
    expected: "task",
    prompt: "Generate unit tests for the UserService class.",
  },
  {
    category: "task · fix",
    expected: "task",
    prompt: "Fix the bug in the payment module where duplicate charges occur.",
  },
  {
    category: "task · migrate",
    expected: "task",
    prompt: "Migrate the database schema to add a createdAt column to all tables.",
  },
  {
    category: "task · install",
    expected: "task",
    prompt: "Install the required dependencies and set up the dev environment.",
  },
  {
    category: "task · optimize",
    expected: "task",
    prompt: "Optimize the SQL query in the reports endpoint — it's taking over 10 seconds.",
  },
  {
    category: "task · integrate",
    expected: "task",
    prompt: "Integrate Stripe payments into the checkout flow.",
  },
  {
    category: "task · delete",
    expected: "task",
    prompt: "Remove all unused imports from the codebase.",
  },
  {
    category: "task · rename",
    expected: "task",
    prompt: "Rename all .js files to .ts in the src directory.",
  },
  {
    category: "task · send",
    expected: "task",
    prompt: "Send a summary email to the team with this week's progress.",
  },

  // ── More CHAT ───────────────────────────────────────────────────────────────
  {
    category: "chat · question",
    expected: "chat",
    prompt: "What's the time complexity of quicksort?",
  },
  {
    category: "chat · question",
    expected: "chat",
    prompt: "What is the difference between a process and a thread?",
  },
  { category: "chat · question", expected: "chat", prompt: "Is Rust memory safe?" },
  { category: "chat · question", expected: "chat", prompt: "What year was Python created?" },
  { category: "chat · explain", expected: "chat", prompt: "Explain the CAP theorem." },
  { category: "chat · explain", expected: "chat", prompt: "How does OAuth2 work?" },
  { category: "chat · explain", expected: "chat", prompt: "What are the SOLID principles?" },
  { category: "chat · compare", expected: "chat", prompt: "Which is faster, Redis or Memcached?" },
  {
    category: "chat · compare",
    expected: "chat",
    prompt: "Should I use Redux or Context API for global state?",
  },
  { category: "chat · definition", expected: "chat", prompt: "What is eventual consistency?" },
  { category: "chat · definition", expected: "chat", prompt: "What is a race condition?" },
  {
    category: "chat · code-help",
    expected: "chat",
    prompt: "What's the difference between == and === in JavaScript?",
  },
  {
    category: "chat · code-help",
    expected: "chat",
    prompt: "Why do we use interfaces in TypeScript?",
  },
  {
    category: "chat · code-help",
    expected: "chat",
    prompt: "How does indexing speed up database queries?",
  },
  { category: "chat · opinion", expected: "chat", prompt: "Is TypeScript worth learning in 2024?" },
  {
    category: "chat · debug",
    expected: "chat",
    prompt: "Why does React re-render so often in my component?",
  },

  // ── More TASK ───────────────────────────────────────────────────────────────
  {
    category: "task · create",
    expected: "task",
    prompt: "Create a Dockerfile for the Node.js app.",
  },
  {
    category: "task · create",
    expected: "task",
    prompt: "Create a GitHub Actions workflow to run tests on every PR.",
  },
  {
    category: "task · write",
    expected: "task",
    prompt: "Write a bash script to back up the database nightly.",
  },
  { category: "task · add", expected: "task", prompt: "Add a rate limiter to the API endpoints." },
  { category: "task · add", expected: "task", prompt: "Add logging to every API endpoint." },
  { category: "task · add", expected: "task", prompt: "Add pagination to the /users endpoint." },
  {
    category: "task · add",
    expected: "task",
    prompt: "Add input validation to the registration endpoint.",
  },
  {
    category: "task · move",
    expected: "task",
    prompt: "Move the hardcoded config values to environment variables.",
  },
  {
    category: "task · move",
    expected: "task",
    prompt: "Extract the email templates into their own directory.",
  },
  {
    category: "task · run",
    expected: "task",
    prompt: "Seed the database with the sample data from fixtures.json.",
  },
  {
    category: "task · run",
    expected: "task",
    prompt: "Profile the app and identify the main performance bottleneck.",
  },
  { category: "task · fix", expected: "task", prompt: "Enable CORS for the staging domain." },
  {
    category: "task · fix",
    expected: "task",
    prompt: "Pin all dependencies to their current exact versions in package.json.",
  },
  {
    category: "task · scan",
    expected: "task",
    prompt: "Scan the codebase for TODO comments and list them.",
  },
  {
    category: "task · convert",
    expected: "task",
    prompt: "Convert this class component to a functional component.",
  },
  { category: "task · convert", expected: "task", prompt: "Translate the README into French." },

  // ── Borderline / Tricky ─────────────────────────────────────────────────────
  {
    category: "tricky · how-to",
    expected: "chat",
    prompt: "How do I write a Docker Compose file?",
  },
  {
    category: "tricky · imperative",
    expected: "task",
    prompt: "Go through the codebase and remove all console.log statements.",
  },
  {
    category: "tricky · passive",
    expected: "chat",
    prompt: "I want to understand how React's reconciler works.",
  },
  {
    category: "tricky · show-me",
    expected: "chat",
    prompt: "Show me an example of a binary search in Python.",
  },
  {
    category: "tricky · add-feature",
    expected: "task",
    prompt: "Add dark mode support to the settings page.",
  },
  {
    category: "tricky · check+fix",
    expected: "task",
    prompt: "Check the API is returning correct status codes and fix any that are wrong.",
  },
  {
    category: "tricky · tell-me",
    expected: "chat",
    prompt: "Tell me what dependencies this project uses.",
  },
  {
    category: "tricky · help-me",
    expected: "task",
    prompt: "Help me rename all .js files to .ts in the src directory.",
  },
  { category: "tricky · short", expected: "task", prompt: "Do it." },
  {
    category: "tricky · summarize",
    expected: "chat",
    prompt: "Summarize how this app works based on the code.",
  },
  {
    category: "tricky · update",
    expected: "task",
    prompt: "Update the README with the new environment variables we added.",
  },
  { category: "tricky · look", expected: "chat", prompt: "Look at the error — what's wrong?" },
  {
    category: "tricky · can-you",
    expected: "task",
    prompt: "Can you add error handling to this function?",
  },
  {
    category: "tricky · hypothetical",
    expected: "chat",
    prompt: "What would happen if I deleted the migrations folder?",
  },
  {
    category: "tricky · understand",
    expected: "chat",
    prompt: "Help me understand what this regex does.",
  },
  {
    category: "tricky · is-there",
    expected: "chat",
    prompt: "Is there a memory leak in this code?",
  },
  {
    category: "tricky · could-you",
    expected: "task",
    prompt: "Could you refactor this to be more readable?",
  },
  {
    category: "tricky · i-need",
    expected: "task",
    prompt: "I need to add authentication to the app.",
  },
  { category: "tricky · make", expected: "task", prompt: "Make this function async." },
  { category: "tricky · clean", expected: "task", prompt: "Clean up this file." },
  { category: "tricky · debug+push", expected: "task", prompt: "Debug this and push the fix." },
  {
    category: "tricky · walk-me",
    expected: "chat",
    prompt: "Walk me through how this code works.",
  },
  { category: "tricky · lets", expected: "task", prompt: "Let's set up a staging environment." },
  { category: "tricky · what-does", expected: "chat", prompt: "What does this error mean?" },
  { category: "tricky · how-to", expected: "chat", prompt: "Tell me how to configure nginx." },
  { category: "tricky · am-i", expected: "chat", prompt: "Am I using this hook correctly?" },
  {
    category: "tricky · list",
    expected: "chat",
    prompt: "List the available npm scripts in this project.",
  },
  {
    category: "tricky · find-out",
    expected: "chat",
    prompt: "Find out why this function returns undefined.",
  },
  {
    category: "tricky · show-me",
    expected: "chat",
    prompt: "Show me the current database schema.",
  },
  { category: "tricky · write-it", expected: "task", prompt: "Write it for me." },
  { category: "tricky · run-it", expected: "task", prompt: "Run it." },
  {
    category: "tricky · what-if",
    expected: "chat",
    prompt: "What if I switch to a microservices architecture?",
  },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

interface Result {
  c: Case;
  intent: "chat" | "task";
  confidence: number;
  correct: boolean;
  error?: string;
  durationMs: number;
}

async function runCase(c: Case): Promise<Result> {
  const start = Date.now();
  try {
    const r = await classifyIntent(c.prompt, [], CONFIG, PROFILE, MODEL);
    const effective = r.confidence >= CONFIDENCE_THRESHOLD ? r.intent : "chat";
    return {
      c,
      intent: effective,
      confidence: r.confidence,
      correct: effective === c.expected,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      c,
      intent: "chat",
      confidence: 0,
      correct: "chat" === c.expected,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function runAll(cases: Case[], concurrency: number): Promise<Result[]> {
  const results: Result[] = [];
  const queue = [...cases];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const c = queue.shift()!;
      process.stdout.write(".");
      results.push(await runCase(c));
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Report ───────────────────────────────────────────────────────────────────

const G = "\x1b[32m"; // green
const R = "\x1b[31m"; // red
const Y = "\x1b[33m"; // yellow
const B = "\x1b[1m"; // bold
const D = "\x1b[2m"; // dim
const X = "\x1b[0m"; // reset
const C = "\x1b[36m"; // cyan

function pct(n: number, total: number) {
  return total === 0
    ? "  —"
    : `${Math.round((n / total) * 100)
        .toString()
        .padStart(3)}%`;
}

function bar(n: number, total: number, width = 20) {
  const filled = Math.round((n / total) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function printReport(results: Result[]) {
  const correct = results.filter((r) => r.correct).length;
  const total = results.length;
  const accuracy = correct / total;

  // ── Per-result table ────────────────────────────────────────────────────────
  console.log(
    `\n\n${B}━━━ Results ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}\n`
  );

  const colW = 54;
  const header = [
    "Prompt".padEnd(colW),
    "Expected".padEnd(9),
    "Got".padEnd(9),
    "Conf".padEnd(7),
    "ms".padEnd(6),
    "",
  ].join(" ");
  console.log(`${D}${header}${X}`);
  console.log(`${D}${"─".repeat(100)}${X}`);

  for (const r of results.sort((a, b) => (a.correct ? 1 : 0) - (b.correct ? 1 : 0))) {
    const mark = r.correct ? `${G}✓${X}` : `${R}✗${X}`;
    const col = r.correct ? G : R;
    const prompt =
      r.c.prompt.length > colW ? r.c.prompt.slice(0, colW - 1) + "…" : r.c.prompt.padEnd(colW);
    const conf = r.error ? `${Y}ERR${X}  ` : `${col}${r.confidence.toFixed(2)}${X} `;
    const got = r.intent.padEnd(9);
    console.log(
      `${mark} ${D}${prompt}${X} ` +
        `${D}${r.c.expected.padEnd(9)}${X}` +
        `${col}${got}${X}` +
        `${conf}` +
        `${D}${String(r.durationMs).padStart(5)}${X}` +
        (r.error ? ` ${Y}⚠ ${r.error.slice(0, 40)}${X}` : "")
    );
  }

  // ── Category breakdown ──────────────────────────────────────────────────────
  console.log(`\n${B}━━━ Category Breakdown ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}\n`);

  const cats = new Map<string, { correct: number; total: number }>();
  for (const r of results) {
    const key = r.c.category.split(" · ")[0]; // "chat" | "task" | "tricky"
    const entry = cats.get(key) ?? { correct: 0, total: 0 };
    entry.total++;
    if (r.correct) entry.correct++;
    cats.set(key, entry);
  }
  for (const [cat, { correct: c, total: t }] of cats) {
    const p = c / t;
    const col = p >= 0.8 ? G : p >= 0.6 ? Y : R;
    console.log(
      `  ${B}${cat.padEnd(8)}${X}  ${col}${bar(c, t)}${X}  ${col}${pct(c, t)}${X}  ${D}(${c}/${t})${X}`
    );
  }

  // ── Failures list ───────────────────────────────────────────────────────────
  const failures = results.filter((r) => !r.correct);
  if (failures.length > 0) {
    console.log(
      `\n${B}━━━ Misclassified (${failures.length}) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}\n`
    );
    for (const r of failures) {
      console.log(
        `  ${R}✗${X} ${D}[${r.c.category}]${X}\n` +
          `    "${r.c.prompt}"\n` +
          `    expected ${B}${r.c.expected}${X} → got ${R}${r.intent}${X} (conf ${r.confidence.toFixed(2)})\n`
      );
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`${B}━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}\n`);
  const col = accuracy >= PASS_THRESHOLD ? G : accuracy >= 0.6 ? Y : R;
  const avgConf = results.reduce((s, r) => s + r.confidence, 0) / results.length;
  const avgMs = results.reduce((s, r) => s + r.durationMs, 0) / results.length;
  console.log(`  Model       : ${C}${MODEL}${X}`);
  console.log(`  Threshold   : confidence ≥ ${CONFIDENCE_THRESHOLD}`);
  console.log(`  Cases       : ${total}`);
  console.log(`  Correct     : ${col}${correct}${X} / ${total}`);
  console.log(
    `  Accuracy    : ${col}${B}${(accuracy * 100).toFixed(1)}%${X}  ${col}${bar(correct, total)}${X}`
  );
  console.log(`  Avg conf    : ${avgConf.toFixed(2)}`);
  console.log(`  Avg latency : ${avgMs.toFixed(0)} ms\n`);

  const pass = accuracy >= PASS_THRESHOLD;
  console.log(
    pass
      ? `${G}${B}  ✓ PASS — accuracy meets the ${(PASS_THRESHOLD * 100).toFixed(0)}% threshold.${X}\n`
      : `${R}${B}  ✗ FAIL — accuracy below the ${(PASS_THRESHOLD * 100).toFixed(0)}% threshold.${X}\n`
  );

  process.exit(pass ? 0 : 1);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

console.log(`${B}Intent Classifier Accuracy Benchmark${X}`);
console.log(`${D}Model: ${MODEL}  |  Cases: ${CASES.length}  |  Concurrency: ${CONCURRENCY}${X}`);
console.log(`\nRunning`);

runAll(CASES, CONCURRENCY)
  .then(printReport)
  .catch((err) => {
    console.error("\nFatal error:", err);
    process.exit(1);
  });
