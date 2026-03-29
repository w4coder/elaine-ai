/**
 * Accuracy benchmark runner that reads DeepSeek profiles from the live DB.
 * Run: node --import tsx/esm src/classifier/run-deepseek-accuracy.ts
 */
import { db } from "../db/database.js";
import { decryptApiKey } from "../utils/crypto.js";
import { classifyIntent, resolveClassifierModel } from "./intentClassifier.js";
import type { ClassifierConfig, IntentResult } from "./intentClassifier.js";
import type { ProviderProfile } from "../types.js";

// ─── Load profiles from DB ────────────────────────────────────────────────────

const settingsRow = db.prepare("SELECT value FROM settings WHERE key = 'app_settings'").get() as {
  value: string;
};
const appSettings = JSON.parse(settingsRow.value) as {
  profiles: Array<{
    id: string;
    name: string;
    providerType: string;
    baseUrl: string;
    defaultModel?: string;
    apiKey?: string;
    enabled: boolean;
  }>;
};

const deepseekProfiles = appSettings.profiles.filter(
  (p) => p.name.includes("DeepSeek") && p.enabled
);
if (deepseekProfiles.length === 0) {
  console.error("No DeepSeek profiles found in settings.");
  process.exit(1);
}

// ─── Test cases (100 per model) ───────────────────────────────────────────────

interface Case {
  prompt: string;
  expected: "chat" | "task";
  category: string;
}

const CASES: Case[] = [
  // ── Clear CHAT (30) ────────────────────────────────────────────────────────
  {
    category: "chat·question",
    expected: "chat",
    prompt: "What is the difference between TCP and UDP?",
  },
  {
    category: "chat·question",
    expected: "chat",
    prompt: "How does garbage collection work in Java?",
  },
  { category: "chat·question", expected: "chat", prompt: "What is the capital of France?" },
  { category: "chat·question", expected: "chat", prompt: "Explain how HTTPS encryption works." },
  { category: "chat·question", expected: "chat", prompt: "What is the meaning of life?" },
  {
    category: "chat·question",
    expected: "chat",
    prompt: "Can you explain what a neural network is?",
  },
  {
    category: "chat·question",
    expected: "chat",
    prompt: "What is the difference between Python 2 and Python 3?",
  },
  { category: "chat·question", expected: "chat", prompt: "How does a CPU cache work?" },
  {
    category: "chat·question",
    expected: "chat",
    prompt: "What is the difference between REST and GraphQL?",
  },
  { category: "chat·question", expected: "chat", prompt: "How do you define recursion?" },
  { category: "chat·opinion", expected: "chat", prompt: "What do you think about TypeScript?" },
  { category: "chat·opinion", expected: "chat", prompt: "Is React better than Vue?" },
  { category: "chat·opinion", expected: "chat", prompt: "Do you like Python?" },
  { category: "chat·opinion", expected: "chat", prompt: "What's your take on microservices?" },
  {
    category: "chat·opinion",
    expected: "chat",
    prompt: "Do you think AI will replace programmers?",
  },
  {
    category: "chat·explain",
    expected: "chat",
    prompt: "Explain what a closure is in JavaScript.",
  },
  {
    category: "chat·explain",
    expected: "chat",
    prompt: "Tell me about the history of the internet.",
  },
  {
    category: "chat·explain",
    expected: "chat",
    prompt: "Describe what happens when you type a URL in a browser.",
  },
  { category: "chat·explain", expected: "chat", prompt: "What are the main principles of OOP?" },
  { category: "chat·explain", expected: "chat", prompt: "Describe the CAP theorem." },
  { category: "chat·casual", expected: "chat", prompt: "Good morning!" },
  { category: "chat·casual", expected: "chat", prompt: "Thanks for your help yesterday." },
  { category: "chat·casual", expected: "chat", prompt: "That makes sense, thanks." },
  { category: "chat·casual", expected: "chat", prompt: "Interesting, I didn't know that." },
  { category: "chat·casual", expected: "chat", prompt: "Can you remind me what we talked about?" },
  { category: "chat·lookup", expected: "chat", prompt: "What does 'idempotent' mean?" },
  {
    category: "chat·lookup",
    expected: "chat",
    prompt: "What is the time complexity of quicksort?",
  },
  { category: "chat·lookup", expected: "chat", prompt: "What does HTTP 429 mean?" },
  { category: "chat·lookup", expected: "chat", prompt: "What is the default port for PostgreSQL?" },
  { category: "chat·lookup", expected: "chat", prompt: "What does ACID stand for in databases?" },

  // ── Clear TASK (40) ────────────────────────────────────────────────────────
  {
    category: "task·create",
    expected: "task",
    prompt: "Write a Python script to parse a CSV file.",
  },
  {
    category: "task·create",
    expected: "task",
    prompt: "Create a REST API endpoint in FastAPI for user login.",
  },
  {
    category: "task·create",
    expected: "task",
    prompt: "Build a React component that shows a list of todos.",
  },
  {
    category: "task·create",
    expected: "task",
    prompt: "Generate a SQL migration to add an index to the users table.",
  },
  {
    category: "task·create",
    expected: "task",
    prompt: "Write unit tests for my authentication service.",
  },
  {
    category: "task·create",
    expected: "task",
    prompt: "Create a Dockerfile for a Node.js application.",
  },
  {
    category: "task·create",
    expected: "task",
    prompt: "Write a bash script to back up my database nightly.",
  },
  {
    category: "task·create",
    expected: "task",
    prompt: "Generate a TypeScript interface for this JSON response.",
  },
  { category: "task·create", expected: "task", prompt: "Write a function to debounce user input." },
  { category: "task·create", expected: "task", prompt: "Create a GitHub Actions workflow for CI." },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Refactor this function to use async/await instead of callbacks.",
  },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Update the login form to add two-factor authentication.",
  },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Rename all instances of 'userId' to 'user_id' in the codebase.",
  },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Fix the bug where the pagination resets when sorting.",
  },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Add error handling to the payment processing function.",
  },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Optimize this SQL query to avoid the N+1 problem.",
  },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Convert this class component to a functional React component.",
  },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Add TypeScript types to this JavaScript module.",
  },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Make this endpoint rate-limited to 100 requests per minute.",
  },
  {
    category: "task·modify",
    expected: "task",
    prompt: "Extract this logic into a reusable helper function.",
  },
  {
    category: "task·find",
    expected: "task",
    prompt: "Find all files where we import from the old auth module.",
  },
  { category: "task·find", expected: "task", prompt: "Search the codebase for any TODO comments." },
  {
    category: "task·find",
    expected: "task",
    prompt: "Find where we handle 404 errors in the Express app.",
  },
  {
    category: "task·find",
    expected: "task",
    prompt: "Look for any hardcoded API keys in the repo.",
  },
  {
    category: "task·find",
    expected: "task",
    prompt: "Find all places we call the deprecated sendEmail function.",
  },
  {
    category: "task·analyze",
    expected: "task",
    prompt: "Analyze the performance bottlenecks in my server logs.",
  },
  {
    category: "task·analyze",
    expected: "task",
    prompt: "Review my code and identify security vulnerabilities.",
  },
  {
    category: "task·analyze",
    expected: "task",
    prompt: "Check if there are any memory leaks in this Node.js service.",
  },
  { category: "task·analyze", expected: "task", prompt: "Audit the dependencies for known CVEs." },
  {
    category: "task·analyze",
    expected: "task",
    prompt: "Summarize the changes in the last 10 commits.",
  },
  {
    category: "task·run",
    expected: "task",
    prompt: "Run the test suite and show me which tests are failing.",
  },
  {
    category: "task·run",
    expected: "task",
    prompt: "Deploy the latest build to the staging environment.",
  },
  {
    category: "task·run",
    expected: "task",
    prompt: "Install the required dependencies for this project.",
  },
  {
    category: "task·run",
    expected: "task",
    prompt: "Start the development server with hot reload enabled.",
  },
  { category: "task·run", expected: "task", prompt: "Run the database migrations." },
  {
    category: "task·send",
    expected: "task",
    prompt: "Send a Slack notification when the build fails.",
  },
  { category: "task·send", expected: "task", prompt: "Email the weekly report to the team." },
  {
    category: "task·send",
    expected: "task",
    prompt: "Post a summary of today's standup to the #general channel.",
  },
  { category: "task·send", expected: "task", prompt: "Submit a PR with these changes." },
  { category: "task·send", expected: "task", prompt: "Create a GitHub issue for this bug." },

  // ── Tricky / Borderline (30) ───────────────────────────────────────────────
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "How would I write a function to parse CSV?",
  },
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "What's the best approach to caching API responses?",
  },
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "How can I improve the performance of my SQL queries?",
  },
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "What's the cleanest way to handle error states in React?",
  },
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "Is there a library that handles JWT refresh tokens automatically?",
  },
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "What's a good pattern for managing state in a large app?",
  },
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "How do I typically set up rate limiting in Express?",
  },
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "What are the tradeoffs between Redis and Memcached?",
  },
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "What tools do teams usually use for API documentation?",
  },
  {
    category: "tricky·chat-leaning",
    expected: "chat",
    prompt: "What's the difference between authentication and authorization?",
  },
  {
    category: "tricky·task-leaning",
    expected: "task",
    prompt: "Can you write that function for me?",
  },
  {
    category: "tricky·task-leaning",
    expected: "task",
    prompt: "Please fix the bug I just described.",
  },
  {
    category: "tricky·task-leaning",
    expected: "task",
    prompt: "Go ahead and refactor the auth module.",
  },
  {
    category: "tricky·task-leaning",
    expected: "task",
    prompt: "I need you to set up the CI pipeline.",
  },
  {
    category: "tricky·task-leaning",
    expected: "task",
    prompt: "Could you search the codebase for that pattern?",
  },
  {
    category: "tricky·task-leaning",
    expected: "task",
    prompt: "Let's migrate the database to the new schema.",
  },
  {
    category: "tricky·task-leaning",
    expected: "task",
    prompt: "Help me debug why the tests are failing.",
  },
  {
    category: "tricky·task-leaning",
    expected: "task",
    prompt: "Figure out what's causing the memory spike.",
  },
  {
    category: "tricky·task-leaning",
    expected: "task",
    prompt: "I want to add pagination to the users endpoint.",
  },
  { category: "tricky·task-leaning", expected: "task", prompt: "Let's add dark mode to the app." },
  { category: "tricky·ambiguous", expected: "chat", prompt: "Tell me more about that." },
  { category: "tricky·ambiguous", expected: "chat", prompt: "What about the other approach?" },
  { category: "tricky·ambiguous", expected: "chat", prompt: "Can you elaborate on that?" },
  { category: "tricky·ambiguous", expected: "chat", prompt: "That's interesting, what else?" },
  { category: "tricky·ambiguous", expected: "chat", prompt: "What do you suggest?" },
  { category: "tricky·ambiguous", expected: "chat", prompt: "And then?" },
  { category: "tricky·ambiguous", expected: "chat", prompt: "How about now?" },
  { category: "tricky·ambiguous", expected: "task", prompt: "Do it." },
  { category: "tricky·ambiguous", expected: "task", prompt: "Make it work." },
  { category: "tricky·ambiguous", expected: "task", prompt: "Fix it." },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

const CONFIG: ClassifierConfig = { enabled: true, confidenceThreshold: 0.6 };
const CONCURRENCY = 5;
const PASS_THRESHOLD = 0.75;

interface Result {
  c: Case;
  intent: "chat" | "task";
  confidence: number;
  correct: boolean;
  error?: string;
  durationMs: number;
}

async function runCase(c: Case, profile: ProviderProfile, model: string): Promise<Result> {
  const start = Date.now();
  try {
    const r = await classifyIntent(c.prompt, [], CONFIG, profile, model);
    const effective = r.confidence >= CONFIG.confidenceThreshold ? r.intent : "chat";
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
      error: String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function runAll(
  cases: Case[],
  profile: ProviderProfile,
  model: string,
  concurrency: number
): Promise<Result[]> {
  const results: Result[] = [];
  for (let i = 0; i < cases.length; i += concurrency) {
    const batch = cases.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((c) => runCase(c, profile, model)));
    results.push(...batchResults);
    process.stdout.write(`\r  Progress: ${results.length}/${cases.length}`);
  }
  process.stdout.write("\n");
  return results;
}

function report(results: Result[], profileName: string, model: string) {
  const correct = results.filter((r) => r.correct).length;
  const accuracy = correct / results.length;

  const byCategory = new Map<string, { total: number; correct: number }>();
  for (const r of results) {
    const cat = r.c.category.split("·")[0];
    if (!byCategory.has(cat)) byCategory.set(cat, { total: 0, correct: 0 });
    const s = byCategory.get(cat)!;
    s.total++;
    if (r.correct) s.correct++;
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${profileName} — ${model}`);
  console.log(`${"═".repeat(70)}`);
  console.log(
    `  Overall: ${correct}/${results.length} = ${(accuracy * 100).toFixed(1)}%  ${accuracy >= PASS_THRESHOLD ? "✓ PASS" : "✗ FAIL"}`
  );
  console.log();
  for (const [cat, s] of [...byCategory.entries()].sort()) {
    const pct = ((s.correct / s.total) * 100).toFixed(0).padStart(3);
    const bar = "█".repeat(Math.round((s.correct / s.total) * 20)).padEnd(20, "░");
    console.log(`  ${cat.padEnd(10)} ${bar} ${pct}%  (${s.correct}/${s.total})`);
  }

  // Show failures
  const failures = results.filter((r) => !r.correct);
  if (failures.length > 0) {
    console.log(`\n  Failures (${failures.length}):`);
    for (const r of failures.slice(0, 20)) {
      console.log(
        `    [${r.c.category}] expected=${r.c.expected} got=${r.intent}(${r.confidence.toFixed(2)})`
      );
      console.log(`      "${r.c.prompt.slice(0, 80)}"`);
    }
    if (failures.length > 20) console.log(`    ... and ${failures.length - 20} more`);
  }

  const avgMs = results.reduce((s, r) => s + r.durationMs, 0) / results.length;
  console.log(`\n  Avg latency: ${avgMs.toFixed(0)}ms/call`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

for (const p of deepseekProfiles) {
  const rawModel = p.defaultModel ?? "deepseek-chat";
  const model = resolveClassifierModel(rawModel);
  const apiKey = decryptApiKey(p.apiKey!);

  const profile: ProviderProfile = {
    id: p.id,
    name: p.name,
    providerType: p.providerType as "openai",
    baseUrl: p.baseUrl,
    apiKey,
    enabled: true,
  };

  const label = model !== rawModel ? `${rawModel} → ${model} (auto-substituted)` : model;
  console.log(`\nRunning ${CASES.length} tests for: ${p.name} (${label}) ...`);
  const results = await runAll(CASES, profile, model, CONCURRENCY);
  report(results, p.name, label);
}
