import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function resolveSecret(): string {
  const envKey = process.env.ELAINE_SECRET_KEY;
  if (envKey) return envKey;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ELAINE_SECRET_KEY environment variable is required in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  // Development-only fallback — encrypted values will break if the key changes
  process.stderr.write(
    "[elaine] WARNING: ELAINE_SECRET_KEY is not set. Using insecure default key.\n" +
      "         Set ELAINE_SECRET_KEY in your environment before deploying.\n"
  );
  return "elaine-default-secret-key-do-set-in-env";
}

const SECRET = resolveSecret();
const KEY = scryptSync(SECRET, "elaine-salt-v1", 32);

/** Sentinel the client sends back to signal "keep existing key unchanged". */
export const MASKED = "__masked__";

/** Returns true if the string is an encrypted blob produced by encryptApiKey. */
export function isEncrypted(value: string): boolean {
  return value.startsWith("enc:");
}

export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptApiKey(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) return ciphertext; // plain-text / legacy value
  try {
    const parts = ciphertext.slice(4).split(":");
    if (parts.length !== 3) return "";
    const [ivHex, tagHex, encHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const encrypted = Buffer.from(encHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  } catch {
    // Key mismatch or corrupt data — return empty rather than crashing
    return "";
  }
}
