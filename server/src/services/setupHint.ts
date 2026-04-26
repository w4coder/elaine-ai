import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot } from "../db/database.js";
import { getSettings, saveSettings, listUserModels, createUserModel } from "../db/repository.js";

interface SetupHint {
  provider: "ollama" | "vllm";
  model: string | null;
  createdAt: string;
}

/**
 * Reads `server/data/setup-hint.json` (written by scripts/setup.mjs) and seeds
 * the matching provider profile + default model on first boot. The hint file is
 * removed once consumed so this only runs once per install.
 */
export function applySetupHint(log: {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
}): void {
  const hintPath = resolve(getProjectRoot(), "server", "data", "setup-hint.json");
  if (!existsSync(hintPath)) return;

  let hint: SetupHint;
  try {
    hint = JSON.parse(readFileSync(hintPath, "utf8")) as SetupHint;
  } catch (err) {
    log.warn({ err, hintPath }, "[setupHint] failed to parse — ignoring");
    return;
  }

  const targetProfileId = hint.provider === "ollama" ? "ollama-local" : "vllm-local";
  const settings = getSettings();
  const profile = settings.profiles.find((p) => p.id === targetProfileId);
  if (!profile) {
    log.warn({ targetProfileId }, "[setupHint] target profile missing — skipping");
    safeUnlink(hintPath);
    return;
  }

  const model = hint.model?.trim() || profile.defaultModel;
  const updatedProfiles = settings.profiles.map((p) =>
    p.id === targetProfileId
      ? {
          ...p,
          enabled: true,
          defaultModel: model || p.defaultModel,
          titleModel: model || p.titleModel,
        }
      : p
  );

  saveSettings({
    ...settings,
    activeProfileId: targetProfileId,
    profiles: updatedProfiles,
  });

  if (model) {
    const existing = listUserModels(targetProfileId).find((m) => m.model === model);
    if (!existing) {
      try {
        createUserModel({ profileId: targetProfileId, model });
      } catch (err) {
        log.warn({ err, model }, "[setupHint] createUserModel failed");
      }
    }
  }

  log.info(
    { provider: hint.provider, model, profileId: targetProfileId },
    "[setupHint] applied — provider activated"
  );
  safeUnlink(hintPath);
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}
