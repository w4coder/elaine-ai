/**
 * Robustly extract the first JSON object or array from an LLM response.
 * Handles:
 *  - Inline <think>...</think> blocks (qwen3 / reasoning models)
 *  - Markdown code fences (```json ... ```)
 *  - Leading/trailing prose around the JSON
 */
export function extractJson(raw: string): unknown {
  // 1. Strip <think>...</think> blocks
  const noThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 2. Strip markdown code fences
  const nofence = noThink
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // 3. Try a clean parse first
  if (nofence) {
    try {
      return JSON.parse(nofence);
    } catch {
      // fall through
    }
  }

  // 4. Find the first { or [ and try to parse from there
  const objStart = nofence.indexOf("{");
  const arrStart = nofence.indexOf("[");
  const start =
    objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);

  if (start !== -1) {
    // Walk backwards from end to find matching close bracket
    const opener = nofence[start];
    const closer = opener === "{" ? "}" : "]";
    let end = nofence.lastIndexOf(closer);
    while (end > start) {
      try {
        return JSON.parse(nofence.slice(start, end + 1));
      } catch {
        end = nofence.lastIndexOf(closer, end - 1);
      }
    }
  }

  throw new SyntaxError(`No valid JSON found in LLM response: ${raw.slice(0, 200)}`);
}
