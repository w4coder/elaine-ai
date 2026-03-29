import { createHash } from "node:crypto";

/**
 * Produce a deterministic SHA-256 fingerprint for a memory note.
 * Normalizes text (lowercase, trimmed, collapsed whitespace) before hashing
 * so semantically identical notes hash to the same fingerprint.
 */
export function fingerprintNote(input: {
  kind: string;
  summary: string;
  entities: string[];
}): string {
  const normalize = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, " ");

  const normalized = {
    kind: normalize(input.kind),
    summary: normalize(input.summary),
    entities: [...input.entities].map(normalize).sort(),
  };

  const serialized = JSON.stringify(normalized);
  return createHash("sha256").update(serialized).digest("hex");
}
