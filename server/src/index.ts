import { resolve } from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import dotenv from "dotenv";
import Fastify from "fastify";
import { getProjectRoot, hasBuiltClient } from "./db/database.js";
import { getSettings, listUserModels } from "./db/repository.js";
import { getProfile, getProviderAdapter } from "./providers/index.js";
import { createMemoryModule, createHostAdapter } from "./memory/index.js";
import { TitleService } from "./services/title-service.js";
import { settingsRoutes } from "./routes/settings.js";
import { conversationRoutes } from "./routes/conversations.js";
import { chatRoutes } from "./routes/chat.js";
import { memoryRoutes } from "./routes/memory.js";
import { asrRoutes } from "./routes/asr.js";
import { scheduledJobRoutes } from "./routes/scheduledJobs.js";
import { notificationRoutes } from "./routes/notifications.js";
import { auditRoutes } from "./routes/audit.js";
import { permissionRoutes } from "./routes/permissions.js";
import { channelRoutes } from "./routes/channels.js";
import { ScheduledJobRunner } from "./services/scheduledJobRunner.js";
import { bootAll as bootChannelRunners } from "./channels/runnerManager.js";
import { initMessageRouter } from "./channels/messageRouter.js";

dotenv.config({ path: resolve(getProjectRoot(), ".env") });

const app = Fastify({ logger: true });
const titleService = new TitleService();
const memory = createMemoryModule();

// ─── Memory LLM factory ───────────────────────────────────────────────────────

async function createMemoryLlm(): Promise<(prompt: string) => Promise<string>> {
  return async (prompt: string): Promise<string> => {
    try {
      const settings = getSettings();
      const memProfileId = settings.defaultMemoryProfileId?.trim() || settings.activeProfileId;
      const profile = getProfile(settings, memProfileId);
      const model =
        settings.defaultMemoryModel?.trim() ||
        profile.defaultModel?.trim() ||
        listUserModels(profile.id)[0]?.model?.trim() ||
        "";

      if (!model) {
        app.log.warn({ profileId: profile.id }, "[memoryLlm] No model found — skipping");
        return "";
      }

      const adapter = getProviderAdapter(profile.providerType);
      let content = "";
      let reasoning = "";

      for await (const chunk of adapter.streamChat({
        profile,
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a precise memory extraction assistant. Return only valid JSON as instructed.",
          },
          { role: "user", content: prompt },
        ],
      })) {
        content += chunk.content ?? "";
        reasoning += (chunk as { reasoning?: string }).reasoning ?? "";
      }

      const result = content.trim() || reasoning.trim();
      app.log.info(
        { model, contentChars: content.length, reasoningChars: reasoning.length },
        "[memoryLlm] completed"
      );
      if (!result) {
        app.log.warn(
          { contentSample: content.slice(0, 200), reasoningSample: reasoning.slice(0, 200) },
          "[memoryLlm] empty response"
        );
      }
      return result;
    } catch (err) {
      app.log.error(err, "[memoryLlm] streamChat threw");
      return "";
    }
  };
}

// ─── Static asset registration ────────────────────────────────────────────────

async function registerStaticAssets(): Promise<void> {
  if (!hasBuiltClient()) return;
  await app.register(fastifyStatic, {
    root: resolve(getProjectRoot(), "client", "dist"),
    prefix: "/",
  });
}

// ─── App bootstrap ────────────────────────────────────────────────────────────

async function buildApp(): Promise<void> {
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  await app.register(cors, {
    origin: (origin, callback) => {
      const allowed = process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173";
      if (!origin || origin === allowed) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"), false);
    },
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(settingsRoutes);
  await app.register(conversationRoutes);
  await app.register(chatRoutes, { memory, titleService });
  await app.register(memoryRoutes);
  await app.register(asrRoutes);
  await app.register(scheduledJobRoutes);
  await app.register(notificationRoutes);
  await app.register(auditRoutes);
  await app.register(permissionRoutes);
  await app.register(channelRoutes);

  await registerStaticAssets();

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.method === "GET" && !request.url.startsWith("/api") && hasBuiltClient()) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const llm = await createMemoryLlm();
  await memory.init({
    llm,
    embed: null,
    adapter: createHostAdapter(),
  });
  memory.start("local_user");
  initMessageRouter(memory);

  const jobRunner = new ScheduledJobRunner();
  jobRunner.start();

  await bootChannelRunners();

  await buildApp();

  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ host, port });
  app.log.info(`Elaine server running at http://${host}:${port}`);
}

start().catch((error) => {
  app.log.error(error);
  process.exitCode = 1;
});
