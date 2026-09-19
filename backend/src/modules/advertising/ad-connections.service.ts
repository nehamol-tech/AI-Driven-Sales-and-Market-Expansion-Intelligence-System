/* eslint-disable @typescript-eslint/no-explicit-any */
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import type { AdConnectionDTO, AdPlatform } from "@ai-sales/shared";
import { AD_PLATFORMS } from "@ai-sales/shared";
import { env } from "../../config/env.js";
import { encryptSecret, CredentialEncryptionNotConfiguredError } from "../../lib/crypto.js";
import { getPlatformClient, isPlatformConfigured } from "./ad-platform-clients/platform-client.factory.js";
import { toAdConnectionDTO } from "./advertising.dto.js";

/**
 * Narrow, injectable Prisma-like dependency interface (mirrors
 * RevenueAnalyticsPrismaDeps) so this whole module is unit-testable without
 * a live DB. A real PrismaClient satisfies this structurally.
 */
export interface AdConnectionsPrismaDeps {
  adAccountConnection: {
    findMany(args: any): Promise<any[]>;
    findUnique(args: any): Promise<any | null>;
    upsert(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
}

const OAUTH_STATE_TTL = "10m";

interface OAuthStatePayload {
  companyId: string;
  platform: AdPlatform;
  nonce: string;
}

/**
 * The OAuth `state` param is a short-lived signed JWT (reusing the same
 * JWT_SECRET already required by this app — no new secret needed) encoding
 * companyId+platform+a random nonce, rather than anything held in server
 * memory. This lets the callback (a separate HTTP request, possibly hitting
 * a different backend instance) verify the request genuinely originated
 * from this app's own authorize step and for this exact
 * company/platform — the standard CSRF-defense purpose of OAuth `state` —
 * without needing shared server-side session storage.
 */
function signOAuthState(payload: OAuthStatePayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: OAUTH_STATE_TTL });
}

function verifyOAuthState(token: string): OAuthStatePayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || !decoded) {
    throw new Error("Invalid OAuth state token");
  }
  const { companyId, platform, nonce } = decoded as Record<string, unknown>;
  if (typeof companyId !== "string" || typeof platform !== "string" || typeof nonce !== "string") {
    throw new Error("Invalid OAuth state token payload");
  }
  return { companyId, platform: platform as AdPlatform, nonce };
}

const connectionInclude = { connectedBy: { select: { name: true } } };

/**
 * Always returns exactly one entry per AD_PLATFORMS value, even when the
 * company has never connected it — `status: "DISCONNECTED"` in that case,
 * never a missing array entry.
 */
export async function getConnections(deps: AdConnectionsPrismaDeps, companyId: string): Promise<AdConnectionDTO[]> {
  const rows = await deps.adAccountConnection.findMany({ where: { companyId }, include: connectionInclude });
  const byPlatform = new Map((rows as any[]).map((r) => [r.platform as AdPlatform, r]));
  return AD_PLATFORMS.map((platform) => {
    const configured = isPlatformConfigured(platform);
    const row = byPlatform.get(platform);
    if (!row) {
      return { platform, status: "DISCONNECTED" as const, externalAccountId: null, lastSyncedAt: null, connectedByUserName: null, configured };
    }
    return toAdConnectionDTO(platform, row, configured);
  });
}

export type GetAuthorizeUrlResult = { status: "ok"; url: string } | { status: "not_configured" };

/**
 * Returns a typed "not configured" result (not an exception the route has
 * to guess about) when the relevant *_CLIENT_ID/*_CLIENT_SECRET env vars
 * are unset — this app has zero real credentials configured today, so this
 * is the path every live call in this environment actually takes.
 */
export function getAuthorizeUrl(platform: AdPlatform, companyId: string, redirectUri: string): GetAuthorizeUrlResult {
  const client = getPlatformClient(platform);
  if (!client) return { status: "not_configured" };
  const state = signOAuthState({ companyId, platform, nonce: randomBytes(16).toString("hex") });
  return { status: "ok", url: client.getAuthorizeUrl(state, redirectUri) };
}

export type HandleOAuthCallbackResult =
  | { status: "ok"; connection: AdConnectionDTO }
  | { status: "not_configured" }
  | { status: "invalid_state" }
  | { status: "exchange_failed"; message: string };

/**
 * Exchanges the OAuth `code` for tokens, encrypts both before they ever
 * touch the DB (via lib/crypto.ts), and upserts the AdAccountConnection row.
 * Never returns the raw tokens to the caller — the returned AdConnectionDTO
 * structurally has no field for them.
 */
export async function handleOAuthCallback(
  deps: AdConnectionsPrismaDeps,
  companyId: string,
  userId: string,
  platform: AdPlatform,
  code: string,
  state: string,
  redirectUri: string,
): Promise<HandleOAuthCallbackResult> {
  let statePayload: OAuthStatePayload;
  try {
    statePayload = verifyOAuthState(state);
  } catch {
    return { status: "invalid_state" };
  }
  if (statePayload.companyId !== companyId || statePayload.platform !== platform) {
    return { status: "invalid_state" };
  }

  const client = getPlatformClient(platform);
  if (!client) return { status: "not_configured" };

  let tokens;
  try {
    tokens = await client.exchangeCodeForTokens(code, redirectUri);
  } catch (err) {
    return { status: "exchange_failed", message: err instanceof Error ? err.message : "Unknown error during token exchange" };
  }

  let accessTokenEncrypted: string;
  let refreshTokenEncrypted: string | null;
  try {
    accessTokenEncrypted = encryptSecret(tokens.accessToken);
    refreshTokenEncrypted = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null;
  } catch (err) {
    if (err instanceof CredentialEncryptionNotConfiguredError) return { status: "not_configured" };
    throw err;
  }

  const tokenExpiresAt = tokens.expiresInSeconds != null ? new Date(Date.now() + tokens.expiresInSeconds * 1000) : null;

  const row = await deps.adAccountConnection.upsert({
    where: { companyId_platform: { companyId, platform } },
    create: {
      companyId,
      platform,
      externalAccountId: tokens.externalAccountId,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
      status: "CONNECTED",
      connectedByUserId: userId,
    },
    update: {
      ...(tokens.externalAccountId ? { externalAccountId: tokens.externalAccountId } : {}),
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
      status: "CONNECTED",
      connectedByUserId: userId,
    },
    include: connectionInclude,
  });

  return { status: "ok", connection: toAdConnectionDTO(platform, row, true) };
}

/**
 * Clears the encrypted token fields and marks the connection DISCONNECTED —
 * does NOT delete the row, so `lastSyncedAt` history survives a
 * disconnect/reconnect cycle.
 */
export async function disconnect(deps: AdConnectionsPrismaDeps, companyId: string, platform: AdPlatform): Promise<AdConnectionDTO> {
  const configured = isPlatformConfigured(platform);
  const existing = await deps.adAccountConnection.findUnique({ where: { companyId_platform: { companyId, platform } } });
  if (!existing) {
    return { platform, status: "DISCONNECTED", externalAccountId: null, lastSyncedAt: null, connectedByUserName: null, configured };
  }
  const updated = await deps.adAccountConnection.update({
    where: { id: existing.id },
    data: { accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null, status: "DISCONNECTED" },
    include: connectionInclude,
  });
  return toAdConnectionDTO(platform, updated, configured);
}
