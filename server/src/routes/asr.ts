import os from "node:os";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getSettings } from "../db/repository.js";
import { detectGpu, checkServiceRunning } from "../utils/hardware.js";

export async function asrRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/system-info", async () => {
    const [gpu, vllmRunning, localAiRunning] = await Promise.all([
      detectGpu(),
      checkServiceRunning("http://localhost:8000/v1/models"),
      checkServiceRunning("http://localhost:8080/v1/models"),
    ]);
    return {
      gpu,
      ramMb: Math.round(os.totalmem() / 1024 / 1024),
      vllmRunning,
      localAiRunning,
      platform: process.platform,
    };
  });

  app.post("/api/asr/validate", async (request, reply) => {
    const schema = z.object({
      asrProvider: z.string(),
      asrBaseUrl: z.string().optional(),
      asrApiKey: z.string().optional(),
      asrModel: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: "Invalid request body" });

    const { asrProvider, asrBaseUrl, asrApiKey } = parsed.data;

    if (asrProvider === "browser") {
      return { ok: true };
    }

    if (!asrBaseUrl) {
      return { ok: false, error: "Base URL is required" };
    }

    const baseUrl = asrBaseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = {};
    if (asrApiKey) headers["Authorization"] = `Bearer ${asrApiKey}`;

    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Authentication failed — check your API key" };
      }
      if (!res.ok) {
        if (asrProvider === "vllm" || asrProvider === "vllm-small" || asrProvider === "localai") {
          const startCmd =
            asrProvider === "localai"
              ? "docker run -p 8080:8080 localai/localai:latest"
              : "vllm serve Qwen/Qwen3-ASR-1.7B";
          return {
            ok: false,
            error: `Service not reachable at ${baseUrl}. Start it with: ${startCmd}`,
          };
        }
        return { ok: false, error: `Service returned ${res.status} — check the base URL` };
      }
      return { ok: true };
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === "ECONNREFUSED") {
        const startCmd =
          asrProvider === "localai"
            ? "docker run -p 8080:8080 localai/localai:latest"
            : asrProvider.startsWith("vllm")
              ? `vllm serve Qwen/Qwen3-ASR-${asrProvider === "vllm-small" ? "0.6B" : "1.7B"}`
              : undefined;
        const hint = startCmd ? ` Start it with: ${startCmd}` : "";
        return { ok: false, error: `Connection refused at ${baseUrl}.${hint}` };
      }
      if (cause?.code === "ENOTFOUND") {
        return { ok: false, error: `Host not found: ${baseUrl} — check the URL` };
      }
      return { ok: false, error: err instanceof Error ? err.message : "Could not reach service" };
    }
  });

  app.post("/api/transcribe", async (request, reply) => {
    const { asrProvider, asrBaseUrl, asrApiKey, asrModel } = getSettings();

    if (!asrProvider) {
      return reply.code(400).send({ error: "No ASR provider configured" });
    }
    if (asrProvider === "browser") {
      return reply.code(400).send({ error: "Browser ASR is handled client-side" });
    }
    if (!asrBaseUrl) {
      return reply.code(400).send({ error: "ASR base URL not configured" });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No audio file provided" });
    }

    const audioBuffer = await data.toBuffer();
    const model = asrModel || "whisper-1";
    const baseUrl = asrBaseUrl.replace(/\/$/, "");

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(audioBuffer)], { type: data.mimetype }),
      data.filename
    );
    formData.append("model", model);

    const headers: Record<string, string> = {};
    if (asrApiKey) headers["Authorization"] = `Bearer ${asrApiKey}`;

    try {
      const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
        method: "POST",
        headers,
        body: formData,
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const msg = await res.text();
        return reply.code(res.status).send({ error: msg || `Transcription failed: ${res.status}` });
      }
      const result = (await res.json()) as { text: string };
      return { text: result.text ?? "" };
    } catch (err) {
      return reply
        .code(500)
        .send({ error: err instanceof Error ? err.message : "Transcription failed" });
    }
  });

  app.get("/api/fs/read", async (request, reply) => {
    const query = z.object({ path: z.string().min(1) }).safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "Missing or invalid path" });
    }
    try {
      const { readFileSync } = await import("fs");
      const content = readFileSync(query.data.path, "utf8");
      return { content, path: query.data.path };
    } catch {
      return reply.code(404).send({ error: "File not found or unreadable" });
    }
  });
}
