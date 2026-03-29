import type { FastifyInstance } from "fastify";
import { listAuditLog } from "../services/auditLog.js";

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/audit-log", (request, reply) => {
    const { conversationId, skillName, limit, offset } = request.query as Record<string, string>;
    const entries = listAuditLog({
      conversationId: conversationId || undefined,
      skillName: skillName || undefined,
      limit: limit ? Math.min(Number(limit), 500) : 100,
      offset: offset ? Number(offset) : 0,
    });
    return reply.send(entries);
  });
}
