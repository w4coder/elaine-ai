import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntentWithCompleter, classifyIntent } from "./intentClassifier.js";
import type { ClassifierConfig, IntentResult } from "./intentClassifier.js";
import type { ProviderMessage, ProviderProfile } from "../types.js";

// Minimal mock profile — only used for the disabled-config test path,
// which returns early before touching the adapter.
const mockProfile: ProviderProfile = {
  id: "test",
  name: "Test",
  providerType: "openai",
  baseUrl: "http://localhost:11434",
  enabled: true,
};

const enabledConfig: ClassifierConfig = { enabled: true, confidenceThreshold: 0.6 };
const disabledConfig: ClassifierConfig = { enabled: false, confidenceThreshold: 0.6 };

// ---------------------------------------------------------------------------
// 1. Clear chat intent
// ---------------------------------------------------------------------------
test("classifies chat intent correctly", async () => {
  const result = await classifyIntentWithCompleter(
    "What is the capital of France?",
    [],
    async () => '{"intent":"chat","confidence":0.95}'
  );
  assert.deepEqual(result, { intent: "chat", confidence: 0.95 });
});

// ---------------------------------------------------------------------------
// 2. Clear task intent
// ---------------------------------------------------------------------------
test("classifies task intent correctly", async () => {
  const result = await classifyIntentWithCompleter(
    "Book me a flight to Paris for next Monday",
    [],
    async () => '{"intent":"task","confidence":0.92}'
  );
  assert.deepEqual(result, { intent: "task", confidence: 0.92 });
});

// ---------------------------------------------------------------------------
// 3. Ambiguous message — low confidence falls back to chat at the call site
// ---------------------------------------------------------------------------
test("low confidence score is returned as-is; caller treats it as chat", async () => {
  const result = await classifyIntentWithCompleter(
    "Tell me about this",
    [],
    async () => '{"intent":"task","confidence":0.35}'
  );
  // The classifier returns the raw score — it does not clamp
  assert.equal(result.intent, "task");
  assert.equal(result.confidence, 0.35);

  // Caller applies the threshold
  const effectiveIntent: "chat" | "task" =
    result.confidence >= enabledConfig.confidenceThreshold ? result.intent : "chat";
  assert.equal(effectiveIntent, "chat");
});

// ---------------------------------------------------------------------------
// 4. Provider error → fallback { intent: "chat", confidence: 0 }
// ---------------------------------------------------------------------------
test("returns chat fallback when provider throws", async () => {
  const result = await classifyIntentWithCompleter(
    "Do something complex",
    [],
    async (): Promise<string> => {
      throw new Error("Network error");
    }
  );
  assert.deepEqual(result, { intent: "chat", confidence: 0 });
});

// ---------------------------------------------------------------------------
// 5. Disabled via config — skips entirely, never calls the adapter
// ---------------------------------------------------------------------------
test("skips classification when config.enabled is false", async () => {
  // classifyIntent returns the fallback immediately; getProviderAdapter is never called
  // (passing mockProfile with a non-existent model is safe here)
  const result: IntentResult = await classifyIntent(
    "Send an email to the team",
    [],
    disabledConfig,
    mockProfile,
    "some-model"
  );
  assert.deepEqual(result, { intent: "chat", confidence: 0 });
});

// ---------------------------------------------------------------------------
// 6. History is trimmed to the last 3 turns before sending to the model
// ---------------------------------------------------------------------------
test("trims conversation history to the last 3 turns", async () => {
  const history: ProviderMessage[] = [
    { role: "user", content: "turn1-user" },
    { role: "assistant", content: "turn1-assistant" },
    { role: "user", content: "turn2-user" },
    { role: "assistant", content: "turn2-assistant" },
    { role: "user", content: "turn3-user" },
  ];

  let capturedPrompt = "";
  await classifyIntentWithCompleter("turn4-user", history, async (msgs) => {
    capturedPrompt = msgs[0]?.content ?? "";
    return '{"intent":"chat","confidence":0.9}';
  });

  // Last 3 items: turn2-user, turn2-assistant, turn3-user
  assert.ok(capturedPrompt.includes("turn2-user"), "should include turn2-user");
  assert.ok(capturedPrompt.includes("turn2-assistant"), "should include turn2-assistant");
  assert.ok(capturedPrompt.includes("turn3-user"), "should include turn3-user");

  // First 2 items should have been trimmed
  assert.ok(!capturedPrompt.includes("turn1-user"), "should NOT include turn1-user");
  assert.ok(!capturedPrompt.includes("turn1-assistant"), "should NOT include turn1-assistant");
});
