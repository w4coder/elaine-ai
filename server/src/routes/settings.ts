import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  getSettingsForClient,
  getUserProfile,
  listUserModels,
  saveSettings,
  saveUserProfile,
  createUserModel,
  deleteUserModel,
  getSettings,
  resetAllData,
} from "../db/repository.js";
import { getProfile, getProviderAdapter } from "../providers/index.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const userProfileSchema = z.object({
  version: z.literal(1),
  completedAt: z.string(),
  name: z.string().min(1),
  birthday: z.string().optional(),
  gender: z.string().min(1),
  responseLength: z.string().min(1),
  tone: z.string().min(1),
  toneLevel: z.number().min(0).max(100),
  focusAreas: z.array(z.string()).min(1),
  proactiveness: z.number().min(0).max(100),
  extraContext: z.string().optional(),
});

const settingsSchema = z.object({
  activeProfileId: z.string().min(1),
  defaultSystemPrompt: z.string().min(1),
  titleGenerationEnabled: z.boolean(),
  profiles: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        providerType: z.enum(["openai", "ollama", "vllm"]),
        baseUrl: z.string().url(),
        apiKey: z.string().optional(),
        defaultModel: z.string().optional(),
        titleModel: z.string().optional(),
        classifierModel: z.string().optional(),
        pinnedModels: z.array(z.string()).optional(),
        modelCapabilities: z.record(z.string(), z.array(z.string())).optional(),
        enabled: z.boolean(),
      })
    )
    .min(1),
  asrProvider: z.string().optional(),
  asrBaseUrl: z.string().optional(),
  asrApiKey: z.string().optional(),
  asrModel: z.string().optional(),
  defaultMemoryProfileId: z.string().optional(),
  defaultMemoryModel: z.string().optional(),
});

const userModelSchema = z.object({
  profileId: z.string().min(1),
  model: z.string().min(1),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // User profile
  app.get("/api/user-profile", async (_request, reply) => {
    const profile = getUserProfile();
    if (!profile) return reply.code(204).send();
    return profile;
  });

  app.put("/api/user-profile", async (request, reply) => {
    const parsed = userProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    return saveUserProfile(parsed.data);
  });

  // App settings
  app.get("/api/settings", async () => getSettingsForClient());

  app.put("/api/settings", async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    return saveSettings(parsed.data);
  });

  // User models
  app.get("/api/models", async () => listUserModels());

  app.post("/api/models", async (request, reply) => {
    const parsed = userModelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      return createUserModel(parsed.data);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : "Could not save model." });
    }
  });

  app.delete("/api/models/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }
    deleteUserModel(params.data.id);
    return reply.code(204).send();
  });

  app.post("/api/models/validate", async (request, reply) => {
    const parsed = userModelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const settings = getSettings();
    const profile = getProfile(settings, parsed.data.profileId);
    try {
      const models = await getProviderAdapter(profile.providerType).listModels(profile);
      const supported = models.includes(parsed.data.model.trim());
      if (supported) {
        return { supported: true, availableModels: models };
      }
      const hint = models.length
        ? `Available models: ${models.join(", ")}`
        : "No models found on this provider.";
      return {
        supported: false,
        availableModels: models,
        error: `Model "${parsed.data.model}" not found. ${hint}`,
      };
    } catch (err) {
      return {
        supported: false,
        availableModels: [],
        error: err instanceof Error ? err.message : "Could not reach provider.",
      };
    }
  });

  // Provider utilities
  app.get("/api/providers/models", async (request, reply) => {
    const query = z.object({ profileId: z.string().min(1) }).safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten() });
    }
    try {
      return { models: listUserModels(query.data.profileId).map((entry) => entry.model) };
    } catch (err) {
      app.log.error(err, "listModels failed");
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  app.get("/api/providers/check-model", async (request, reply) => {
    const query = z
      .object({ profileId: z.string().min(1), model: z.string().min(1) })
      .safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten() });
    }
    const settings = getSettings();
    const profile = getProfile(settings, query.data.profileId);
    try {
      const models = await getProviderAdapter(profile.providerType).listModels(profile);
      const supported = models.includes(query.data.model);
      return {
        supported,
        error: supported
          ? undefined
          : `Model "${query.data.model}" was not found on this provider.`,
      };
    } catch (err) {
      return {
        supported: false,
        error: err instanceof Error ? err.message : "Could not reach provider.",
      };
    }
  });

  // Reset all data
  app.post("/api/reset", async (_request, reply) => {
    resetAllData();
    return reply.code(204).send();
  });

  app.post("/api/providers/validate", async (request, reply) => {
    const schema = z.object({
      providerType: z.enum(["openai", "ollama", "vllm"]),
      baseUrl: z.string().url(),
      apiKey: z.string().optional(),
      model: z.string().min(1),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const tempProfile = {
      id: "temp",
      name: "temp",
      enabled: true,
      defaultModel: parsed.data.model,
      pinnedModels: [],
      providerType: parsed.data.providerType,
      baseUrl: parsed.data.baseUrl,
      apiKey: parsed.data.apiKey ?? "",
    };

    try {
      const models = await getProviderAdapter(parsed.data.providerType).listModels(tempProfile);
      const supported = models.includes(parsed.data.model);
      if (supported) return { supported: true, availableModels: models };
      const hint = models.length
        ? `Available models: ${models.join(", ")}`
        : "No models found on this provider.";
      return {
        supported: false,
        availableModels: models,
        error: `Model "${parsed.data.model}" not found. ${hint}`,
      };
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      let message = err instanceof Error ? err.message : "Could not reach provider.";
      if (cause?.code === "ECONNREFUSED") {
        message = `Connection refused at ${parsed.data.baseUrl} — is the provider running?`;
      } else if (cause?.code === "ENOTFOUND") {
        message = `Host not found: ${parsed.data.baseUrl} — check the URL.`;
      } else if (cause?.message) {
        message = `${message}: ${cause.message}`;
      }
      return { supported: false, availableModels: [], error: message };
    }
  });
}
