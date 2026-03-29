import { createHash, randomBytes } from "node:crypto";
import { getSettings } from "../db/repository.js";
import { decryptApiKey, encryptApiKey } from "../utils/crypto.js";
import type { OAuthProvider } from "../types.js";

// ─── Provider configs ─────────────────────────────────────────────────────────

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  usePkce?: boolean;
  extraAuthParams?: Record<string, string>;
  tokenContentType?: "form" | "json"; // default: form
}

const PROVIDER_CONFIGS: Record<Exclude<OAuthProvider, "telegram">, ProviderConfig> = {
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userinfoUrl: "https://api.github.com/user",
    scopes: ["read:user", "user:email"],
  },
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scopes: ["openid", "email", "profile"],
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  discord: {
    authUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userinfoUrl: "https://discord.com/api/users/@me",
    scopes: ["identify", "email"],
  },
  slack: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    userinfoUrl: "https://slack.com/api/users.identity",
    scopes: ["users:read", "users:read.email", "identity.basic", "identity.email"],
  },
  twitter: {
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    userinfoUrl: "https://api.twitter.com/2/users/me",
    scopes: ["users.read", "tweet.read", "offline.access"],
    usePkce: true,
  },
  linkedin: {
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    userinfoUrl: "https://api.linkedin.com/v2/userinfo",
    scopes: ["openid", "profile", "email"],
  },
};

// ─── Pending OAuth state store (in-memory, short-lived) ───────────────────────

interface PendingState {
  provider: OAuthProvider;
  codeVerifier?: string;
  expiresAt: number;
}

const pendingStates = new Map<string, PendingState>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (val.expiresAt < now) pendingStates.delete(key);
  }
}, 60_000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getRedirectUri(provider: OAuthProvider): string {
  const port = process.env.PORT ?? "3001";
  const host = process.env.OAUTH_HOST ?? `127.0.0.1:${port}`;
  return `http://${host}/api/connections/${provider}/callback`;
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Builds and returns an authorization URL for the given provider. */
export function getAuthorizationUrl(provider: OAuthProvider): string {
  if (provider === "telegram") throw new Error("Telegram does not use an OAuth authorization URL");

  const config = PROVIDER_CONFIGS[provider];
  const settings = getSettings();
  const appCfg = settings.connections?.[provider];
  if (!appCfg?.clientId) {
    throw new Error(`OAuth app credentials not configured for ${provider}`);
  }

  const state = randomBytes(16).toString("hex");
  const pending: PendingState = { provider, expiresAt: Date.now() + 10 * 60 * 1000 };

  const params = new URLSearchParams({
    client_id: appCfg.clientId,
    redirect_uri: getRedirectUri(provider),
    scope: config.scopes.join(provider === "twitter" ? " " : " "),
    response_type: "code",
    state,
    ...(config.extraAuthParams ?? {}),
  });

  if (config.usePkce) {
    const codeVerifier = generateCodeVerifier();
    pending.codeVerifier = codeVerifier;
    params.set("code_challenge", generateCodeChallenge(codeVerifier));
    params.set("code_challenge_method", "S256");
  }

  pendingStates.set(state, pending);
  return `${config.authUrl}?${params.toString()}`;
}

export interface OAuthTokenData {
  accountId: string;
  accountName: string | null;
  accountEmail: string | null;
  accountAvatar: string | null;
  accessToken: string; // encrypted
  refreshToken: string | null; // encrypted
  tokenExpiresAt: string | null;
  scopes: string[];
}

/** Validates state, exchanges code for tokens, fetches user info. Returns encrypted token data. */
export async function handleOAuthCallback(
  provider: OAuthProvider,
  code: string,
  state: string
): Promise<OAuthTokenData> {
  const pending = pendingStates.get(state);
  if (!pending || pending.provider !== provider || pending.expiresAt < Date.now()) {
    throw new Error("Invalid or expired OAuth state");
  }
  pendingStates.delete(state);

  const config = PROVIDER_CONFIGS[provider as Exclude<OAuthProvider, "telegram">];
  const settings = getSettings();
  const appCfg = settings.connections?.[provider];
  if (!appCfg?.clientId || !appCfg.clientSecret) {
    throw new Error(`OAuth app credentials not configured for ${provider}`);
  }

  const clientSecret = decryptApiKey(appCfg.clientSecret);

  // Exchange authorization code for tokens
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(provider),
    client_id: appCfg.clientId,
    client_secret: clientSecret,
  });

  if (pending.codeVerifier) {
    tokenBody.set("code_verifier", pending.codeVerifier);
  }

  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    const msg = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${msg}`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    authed_user?: { access_token: string }; // Slack v2
  };

  // Slack v2 returns user token under authed_user
  const accessToken =
    provider === "slack" && tokens.authed_user?.access_token
      ? tokens.authed_user.access_token
      : tokens.access_token;

  const userInfo = await fetchUserInfo(provider, accessToken);

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  return {
    accountId: userInfo.id,
    accountName: userInfo.name,
    accountEmail: userInfo.email,
    accountAvatar: userInfo.avatar,
    accessToken: encryptApiKey(accessToken),
    refreshToken: tokens.refresh_token ? encryptApiKey(tokens.refresh_token) : null,
    tokenExpiresAt: expiresAt,
    scopes: config.scopes,
  };
}

/** Validate a Telegram bot token via getMe and return bot identity. */
export async function validateTelegramToken(
  botToken: string
): Promise<{ id: string; name: string }> {
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/getMe`);
  if (!res.ok) throw new Error("Could not reach Telegram API");
  const data = (await res.json()) as {
    ok: boolean;
    result?: { id: number; first_name: string; username?: string };
  };
  if (!data.ok || !data.result) throw new Error("Invalid Telegram bot token");
  const { id, first_name, username } = data.result;
  return {
    id: String(id),
    name: username ? `${first_name} (@${username})` : first_name,
  };
}

// ─── User info normalisation ──────────────────────────────────────────────────

interface NormalizedUser {
  id: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
}

async function fetchUserInfo(
  provider: OAuthProvider,
  accessToken: string
): Promise<NormalizedUser> {
  const config = PROVIDER_CONFIGS[provider as Exclude<OAuthProvider, "telegram">];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (provider === "github") headers["User-Agent"] = "Elaine-App";

  const res = await fetch(config.userinfoUrl, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch user info from ${provider} (${res.status})`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  switch (provider) {
    case "github":
      return {
        id: String(data.id),
        name: (data.name as string | null) ?? (data.login as string | null),
        email: (data.email as string | null) ?? null,
        avatar: (data.avatar_url as string | null) ?? null,
      };

    case "google":
      return {
        id: data.sub as string,
        name: (data.name as string | null) ?? null,
        email: (data.email as string | null) ?? null,
        avatar: (data.picture as string | null) ?? null,
      };

    case "discord": {
      const avatarHash = data.avatar as string | null;
      return {
        id: data.id as string,
        name: (data.global_name as string | null) ?? (data.username as string | null),
        email: (data.email as string | null) ?? null,
        avatar: avatarHash
          ? `https://cdn.discordapp.com/avatars/${data.id as string}/${avatarHash}.png`
          : null,
      };
    }

    case "slack": {
      const user = (data.user as Record<string, unknown> | undefined) ?? {};
      const profile = (user.profile as Record<string, unknown> | undefined) ?? {};
      return {
        id: (data.user_id as string | null) ?? (user.id as string | null) ?? "",
        name: (user.name as string | null) ?? null,
        email: (profile.email as string | null) ?? null,
        avatar: (profile.image_48 as string | null) ?? null,
      };
    }

    case "twitter": {
      const inner = (data.data as Record<string, unknown> | undefined) ?? data;
      return {
        id: String(inner.id),
        name: (inner.name as string | null) ?? null,
        email: null, // Twitter v2 does not expose email via this endpoint
        avatar: (inner.profile_image_url as string | null) ?? null,
      };
    }

    case "linkedin":
      return {
        id: data.sub as string,
        name: (data.name as string | null) ?? null,
        email: (data.email as string | null) ?? null,
        avatar: (data.picture as string | null) ?? null,
      };

    default:
      return { id: "", name: null, email: null, avatar: null };
  }
}
