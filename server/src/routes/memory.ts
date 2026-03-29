import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  getActiveNotes,
  getMemoryBlocks,
  getNoteById,
  getRecentEpisodes,
  getRecentJobs,
  updateNote,
} from "../memory/memoryDb.js";

const LOCAL_USER = "local_user";

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/memory/notes", async () => getActiveNotes(LOCAL_USER, 200));

  app.get("/api/memory/blocks", async () => getMemoryBlocks(LOCAL_USER, null));

  app.get("/api/memory/jobs", async () => getRecentJobs(10));

  app.get("/api/memory/episodes", async () => getRecentEpisodes(20));

  app.patch("/api/memory/notes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const bodySchema = z.object({
      summary: z.string().min(1).optional(),
      pinned: z.boolean().optional(),
      status: z.enum(["active", "archived"]).optional(),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const note = getNoteById(id);
    if (!note) return reply.code(404).send({ error: "Note not found" });

    const patch: Parameters<typeof updateNote>[1] = {};
    if (parsed.data.summary !== undefined) {
      patch.summary = parsed.data.summary;
      patch.editedByUser = true;
    }
    if (parsed.data.pinned !== undefined) {
      patch.pinnedByUser = parsed.data.pinned;
    }
    if (parsed.data.status !== undefined) {
      patch.status = parsed.data.status;
    }

    updateNote(note.id, patch);
    return { ok: true };
  });

  app.delete("/api/memory/notes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const note = getNoteById(id);
    if (!note) return reply.code(404).send({ error: "Note not found" });
    updateNote(note.id, { status: "archived" });
    return { ok: true };
  });
}
