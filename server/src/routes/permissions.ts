import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { grantCapability, revokeCapability } from "../services/skillPermissions.js";
import type { GrantType } from "../services/skillPermissions.js";

const grantSchema = z.object({
  capability: z.string().min(1),
  // "once"   = grant for one tool execution then auto-revoke
  // "thread" = grant for the rest of this conversation
  // "deny"   = explicit revoke / no grant (client just needs a clean round-trip)
  type: z.enum(["once", "thread", "deny"]).default("thread"),
});

export async function permissionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/conversations/:id/grant-permission", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = grantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { capability, type } = parsed.data;
    if (type === "deny") {
      revokeCapability(id, capability as Parameters<typeof revokeCapability>[1]);
    } else {
      grantCapability(id, capability as Parameters<typeof grantCapability>[1], type as GrantType);
    }
    return reply.send({ ok: true });
  });
}
