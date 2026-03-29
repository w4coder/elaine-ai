import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  deleteOAuthConnection,
  listOAuthConnections,
  upsertOAuthConnection,
} from "../db/repository.js";
import {
  getAuthorizationUrl,
  handleOAuthCallback,
  validateTelegramToken,
} from "../services/oauthManager.js";
import { encryptApiKey } from "../utils/crypto.js";
import { nowIso } from "../utils/time.js";
import type { OAuthProvider } from "../types.js";

const OAUTH_PROVIDERS: OAuthProvider[] = [
  "github",
  "google",
  "discord",
  "slack",
  "twitter",
  "linkedin",
];

/** HTML page sent to the OAuth popup after callback — closes the window and notifies parent. */
function callbackHtml(status: "success" | "error", provider: string, message = ""): string {
  const safeMsg = message.replace(/'/g, "\\'").slice(0, 200);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${status === "success" ? "Connected" : "Error"}</title>
<style>
  body { font-family: system-ui, sans-serif; display:flex; align-items:center; justify-content:center;
    height:100vh; margin:0; background:#0f0f11; color:#e2e8f0; }
  p { font-size:1rem; opacity:.7; }
</style>
</head>
<body>
<p>${status === "success" ? "Connected! Closing…" : `Error: ${message || "OAuth failed"}. You can close this window.`}</p>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage(
        { type: 'oauth_${status}', provider: '${provider}', message: '${safeMsg}' },
        window.location.origin
      );
      setTimeout(() => window.close(), 500);
    } else {
      window.location.href = '/connections';
    }
  } catch(e) { window.location.href = '/connections'; }
</script>
</body>
</html>`;
}

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  // ── List all connected accounts ──────────────────────────────────────────────
  app.get("/api/connections", async () => {
    return listOAuthConnections();
  });

  // ── Start OAuth flow — returns { authUrl } ───────────────────────────────────
  app.post<{ Params: { provider: string } }>(
    "/api/connections/:provider/connect",
    async (request, reply) => {
      const { provider } = request.params;
      if (!OAUTH_PROVIDERS.includes(provider as OAuthProvider)) {
        return reply.code(400).send({ error: `Unknown OAuth provider: ${provider}` });
      }
      try {
        const authUrl = getAuthorizationUrl(provider as OAuthProvider);
        return { authUrl };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  // ── OAuth callback — exchanges code, stores tokens, closes popup ─────────────
  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/connections/:provider/callback",
    async (request, reply) => {
      const { provider } = request.params;
      const { code, state, error } = request.query;

      reply.header("Content-Type", "text/html; charset=utf-8");

      if (error) {
        return reply.send(callbackHtml("error", provider, error));
      }
      if (!code || !state) {
        return reply.send(callbackHtml("error", provider, "Missing code or state parameter"));
      }
      if (!OAUTH_PROVIDERS.includes(provider as OAuthProvider)) {
        return reply.send(callbackHtml("error", provider, `Unknown provider: ${provider}`));
      }

      try {
        const tokenData = await handleOAuthCallback(provider as OAuthProvider, code, state);
        const now = nowIso();
        await upsertOAuthConnection({
          id: randomUUID(),
          provider: provider as OAuthProvider,
          accountId: tokenData.accountId,
          accountName: tokenData.accountName,
          accountEmail: tokenData.accountEmail,
          accountAvatar: tokenData.accountAvatar,
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          tokenExpiresAt: tokenData.tokenExpiresAt,
          scopes: tokenData.scopes,
          createdAt: now,
          updatedAt: now,
        });
        return reply.send(callbackHtml("success", provider));
      } catch (err) {
        app.log.error(err, `[connections] OAuth callback error for ${provider}`);
        return reply.send(callbackHtml("error", provider, (err as Error).message));
      }
    }
  );

  // ── Telegram — validate bot token and store ──────────────────────────────────
  app.post("/api/connections/telegram/token", async (request, reply) => {
    const parse = z.object({ token: z.string().min(1) }).safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: "token required" });

    try {
      const info = await validateTelegramToken(parse.data.token);
      const now = nowIso();
      const conn = await upsertOAuthConnection({
        id: randomUUID(),
        provider: "telegram",
        accountId: info.id,
        accountName: info.name,
        accountEmail: null,
        accountAvatar: null,
        accessToken: encryptApiKey(parse.data.token),
        refreshToken: null,
        tokenExpiresAt: null,
        scopes: [],
        createdAt: now,
        updatedAt: now,
      });
      return conn;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/api/connections/:id", async (request, reply) => {
    deleteOAuthConnection(request.params.id);
    return reply.code(204).send();
  });
}
