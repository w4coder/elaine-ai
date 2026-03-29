import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  clearAllNotifications,
  deleteNotification,
  getNotification,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../db/repository.js";
import { createGenericSse } from "../utils/sse.js";
import { notificationBus } from "../services/notification-bus.js";

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  // ── SSE stream ────────────────────────────────────────────────────────────────
  app.get("/api/events/notifications", async (_request, reply) => {
    const sse = createGenericSse(reply);
    const unsubscribe = notificationBus.subscribe((event) => {
      sse.send(event.type, event);
    });
    sse.onClose(() => {
      unsubscribe();
    });
  });

  // ── REST endpoints ────────────────────────────────────────────────────────────

  app.get("/api/notifications", async (request) => {
    const { limit, unread } = request.query as { limit?: string; unread?: string };
    return listNotifications({
      limit: limit ? Number(limit) : 100,
      unreadOnly: unread === "true",
    });
  });

  app.get("/api/notifications/unread-count", async () => {
    return { count: getUnreadNotificationCount() };
  });

  app.get<{ Params: { id: string } }>("/api/notifications/:id", async (request, reply) => {
    const n = getNotification(request.params.id);
    if (!n) return reply.code(404).send({ error: "Not found" });
    return n;
  });

  app.patch<{ Params: { id: string } }>("/api/notifications/:id", async (request, reply) => {
    const parse = z.object({ read: z.boolean() }).safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: "read (boolean) required" });
    const n = getNotification(request.params.id);
    if (!n) return reply.code(404).send({ error: "Not found" });
    markNotificationRead(request.params.id, parse.data.read);
    return getNotification(request.params.id);
  });

  app.post("/api/notifications/read-all", async () => {
    markAllNotificationsRead();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/notifications/:id", async (request, reply) => {
    deleteNotification(request.params.id);
    return reply.code(204).send();
  });

  app.delete("/api/notifications", async (_request, reply) => {
    clearAllNotifications();
    return reply.code(204).send();
  });
}
