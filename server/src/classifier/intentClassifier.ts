import { getProviderAdapter } from "../providers/index.js";
import type { ProviderMessage, ProviderProfile } from "../types.js";

export interface IntentResult {
  intent: "chat" | "task";
  confidence: number;
}

export interface ClassifierConfig {
  enabled: boolean;
  confidenceThreshold: number;
}

type ClassifierLogger = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
};

const FALLBACK: IntentResult = { intent: "chat", confidence: 0 };
const CLASSIFIER_TIMEOUT_MS = 5000;

/** Strip <think>...</think> blocks that reasoning models may emit even when think=false */
function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * More robust JSON extraction: tries direct parse first (model may return pure JSON),
 * then finds the outermost {...} block to handle leading/trailing text.
 */
function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = stripThinkBlocks(raw);

  // Try direct parse first
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // fall through
  }

  // Find outermost brace pair
  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Rules for substituting a better classifier model when the active model is
 * unsuitable for cheap binary classification (e.g. reasoning models).
 *
 * Pattern → replacement: applied as a simple string substitution on the model name.
 * The first matching rule wins.
 */
const CLASSIFIER_MODEL_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // deepseek-reasoner → deepseek-chat (same provider, much faster + no token budget issue)
  { pattern: /^deepseek-reasoner$/i, replacement: "deepseek-chat" },
  // Generic: any *-reasoner model → *-chat sibling
  { pattern: /-reasoner$/i, replacement: "-chat" },
];

/**
 * If the requested model is a reasoning model that performs poorly as a
 * classifier, swap it for the appropriate chat model.
 * Returns the model unchanged if no rule matches.
 */
export function resolveClassifierModel(model: string): string {
  for (const { pattern, replacement } of CLASSIFIER_MODEL_RULES) {
    if (pattern.test(model)) {
      return model.replace(pattern, replacement);
    }
  }
  return model;
}

export function getClassifierConfig(): ClassifierConfig {
  const enabled = process.env.CLASSIFIER_ENABLED !== "false";
  const raw = parseFloat(process.env.CLASSIFIER_CONFIDENCE_THRESHOLD ?? "0.6");
  return {
    enabled,
    confidenceThreshold: isNaN(raw) ? 0.6 : raw,
  };
}

function buildPrompt(message: string, history: ProviderMessage[]): string {
  const last3 = history.slice(-3);
  const historyText =
    last3.length > 0 ? last3.map((m) => `${m.role}: ${m.content}`).join("\n") : "(none)";

  return `You are an intent classifier. Return only valid JSON, no other text.
Classify the user message as:

"chat": questions, opinions, explanations, casual conversation, simple lookups
"task": requests to do something, multi-step actions, anything implying create/find/book/analyze/send/run

Conversation so far:
${historyText}
Latest message: ${message}
Respond with exactly: {"intent": "chat"|"task", "confidence": 0.0-1.0}`;
}

/**
 * Testable core: accepts a completer function instead of a real provider.
 * Handles errors and timeouts internally — never throws.
 */
export async function classifyIntentWithCompleter(
  message: string,
  history: ProviderMessage[],
  completer: (messages: ProviderMessage[]) => Promise<string>,
  logger?: ClassifierLogger
): Promise<IntentResult> {
  try {
    const prompt = buildPrompt(message, history);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Classifier timeout")), CLASSIFIER_TIMEOUT_MS)
    );

    const classifyPromise = (async (): Promise<IntentResult> => {
      const raw = await completer([{ role: "user", content: prompt }]);

      const parsed = extractJson(raw);

      if (!parsed) {
        logger?.warn({ raw: raw.slice(0, 500) }, "Classifier: no JSON found in response");
        return FALLBACK;
      }

      const { intent, confidence } = parsed;

      if ((intent !== "chat" && intent !== "task") || typeof confidence !== "number") {
        logger?.warn(
          { intent, confidence, raw: raw.slice(0, 500) },
          "Classifier: invalid intent/confidence values"
        );
        return FALLBACK;
      }

      logger?.info({ intent, confidence }, "Classifier: parsed result");
      return { intent, confidence };
    })();

    return await Promise.race([classifyPromise, timeoutPromise]);
  } catch (err) {
    logger?.warn({ err: String(err) }, "Classifier: error during classification");
    return FALLBACK;
  }
}

/**
 * Full classifier — uses the real provider adapter.
 * Returns fallback on any error; never throws.
 */
export async function classifyIntent(
  message: string,
  history: ProviderMessage[],
  config: ClassifierConfig,
  profile: ProviderProfile,
  model: string,
  logger?: ClassifierLogger
): Promise<IntentResult> {
  if (!config.enabled) return FALLBACK;

  const adapter = getProviderAdapter(profile.providerType);
  return classifyIntentWithCompleter(
    message,
    history,
    async (messages) => {
      const { content } = await adapter.completeChat({
        profile,
        model,
        messages,
        maxTokens: 100,
        think: false,
      });
      logger?.info({ raw: content.slice(0, 500) }, "Classifier: raw model response");
      return content;
    },
    logger
  );
}
