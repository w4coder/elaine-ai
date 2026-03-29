import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  listScheduledJobs,
  getScheduledJob,
  createScheduledJob,
  updateScheduledJob,
  deleteScheduledJob,
} from "../db/repository.js";
import { parseIntervalMs, computeNextRunAt } from "../services/scheduleParser.js";

const createJobSchema = z.object({
  conversationId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().min(1),
  userPrompt: z.string().min(1),
  profileId: z.string().min(1),
  model: z.string().min(1),
  intervalValue: z.string().min(1),
  runAtTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  runAtDay: z.number().int().min(0).max(6).optional(),
  enabled: z.boolean().default(true),
  maxRuns: z.number().int().positive().nullable().default(null),
});

const patchJobSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  userPrompt: z.string().min(1).optional(),
  intervalValue: z.string().min(1).optional(),
  runAtTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  runAtDay: z.number().int().min(0).max(6).optional(),
  enabled: z.boolean().optional(),
  maxRuns: z.number().int().positive().nullable().optional(),
});

export async function scheduledJobRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/scheduled-jobs", async (_request, reply) => {
    return reply.send(listScheduledJobs());
  });

  app.get("/api/scheduled-jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = getScheduledJob(id);
    if (!job) return reply.code(404).send({ error: "Scheduled job not found." });
    return reply.send(job);
  });

  app.post("/api/scheduled-jobs", async (request, reply) => {
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    let intervalMs: number;
    try {
      intervalMs = parseIntervalMs(parsed.data.intervalValue);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : "Invalid interval." });
    }

    const job = createScheduledJob({
      conversationId: parsed.data.conversationId,
      title: parsed.data.title,
      description: parsed.data.description,
      userPrompt: parsed.data.userPrompt,
      profileId: parsed.data.profileId,
      model: parsed.data.model,
      intervalMs,
      enabled: parsed.data.enabled,
      maxRuns: parsed.data.maxRuns,
      nextRunAt: computeNextRunAt(
        intervalMs,
        undefined,
        parsed.data.runAtTime,
        parsed.data.runAtDay
      ),
    });

    return reply.code(201).send(job);
  });

  app.patch("/api/scheduled-jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    let intervalMs: number | undefined;
    if (parsed.data.intervalValue !== undefined) {
      try {
        intervalMs = parseIntervalMs(parsed.data.intervalValue);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Invalid interval." });
      }
    }

    const updated = updateScheduledJob(id, {
      title: parsed.data.title,
      description: parsed.data.description,
      userPrompt: parsed.data.userPrompt,
      intervalMs,
      enabled: parsed.data.enabled,
      maxRuns: parsed.data.maxRuns,
      ...(intervalMs !== undefined
        ? {
            nextRunAt: computeNextRunAt(
              intervalMs,
              undefined,
              parsed.data.runAtTime,
              parsed.data.runAtDay
            ),
          }
        : {}),
    });

    if (!updated) return reply.code(404).send({ error: "Scheduled job not found." });
    return reply.send(updated);
  });

  app.delete("/api/scheduled-jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = getScheduledJob(id);
    if (!job) return reply.code(404).send({ error: "Scheduled job not found." });
    deleteScheduledJob(id);
    return reply.code(204).send();
  });
}
