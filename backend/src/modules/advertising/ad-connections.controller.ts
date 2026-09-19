import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";
import { logAudit } from "../audit/audit.service.js";
import * as adConnectionsService from "./ad-connections.service.js";
import * as adSyncService from "./ad-sync.service.js";
import { getPlatformClient } from "./ad-platform-clients/platform-client.factory.js";
import type { AdPlatformParam, OAuthCallbackQuery } from "./ad-connections.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

/** The callback route IS the redirect_uri — derived from the incoming request rather than a hardcoded/new env var, so it stays correct in dev/staging/prod without extra config. */
function buildRedirectUri(req: Request, platform: string): string {
  return `${req.protocol}://${req.get("host")}/api/advertising/connections/${platform}/callback`;
}

export async function list(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const connections = await adConnectionsService.getConnections(prisma, companyId);
  res.status(200).json({ data: connections });
}

export async function authorize(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { platform } = req.params as unknown as AdPlatformParam;
  const redirectUri = buildRedirectUri(req, platform);
  const result = adConnectionsService.getAuthorizeUrl(platform, user.companyId, redirectUri);

  if (result.status === "not_configured") {
    res.status(200).json({
      configured: false,
      message: `${platform} ad platform credentials are not configured on this server. Set the corresponding *_CLIENT_ID/*_CLIENT_SECRET environment variables to enable this.`,
    });
    return;
  }

  res.status(200).json({ configured: true, url: result.url });
}

export async function callback(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { platform } = req.params as unknown as AdPlatformParam;
  const { code, state } = req.query as unknown as OAuthCallbackQuery;
  const redirectUri = buildRedirectUri(req, platform);

  const result = await adConnectionsService.handleOAuthCallback(prisma, user.companyId, user.id, platform, code, state, redirectUri);

  if (result.status === "not_configured") {
    res.status(200).json({
      configured: false,
      message: `${platform} ad platform credentials are not configured on this server.`,
    });
    return;
  }
  if (result.status === "invalid_state") {
    throw new BadRequestError("Invalid or expired OAuth state parameter");
  }
  if (result.status === "exchange_failed") {
    res.status(502).json({ error: { message: `Failed to complete ${platform} OAuth token exchange`, details: result.message } });
    return;
  }

  await logAudit({
    userId: user.id,
    action: "AD_ACCOUNT_CONNECTED",
    entityType: "AdAccountConnection",
    entityId: null,
    metadata: { platform },
    ipAddress: req.ip ?? null,
  });

  res.status(200).json(result.connection);
}

export async function disconnect(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { platform } = req.params as unknown as AdPlatformParam;
  const connection = await adConnectionsService.disconnect(prisma, user.companyId, platform);
  await logAudit({
    userId: user.id,
    action: "AD_ACCOUNT_DISCONNECTED",
    entityType: "AdAccountConnection",
    entityId: null,
    metadata: { platform },
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(connection);
}

export async function sync(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { platform } = req.params as unknown as AdPlatformParam;

  const client = getPlatformClient(platform);
  if (!client) {
    res.status(200).json({
      configured: false,
      message: `${platform} ad platform credentials are not configured on this server.`,
    });
    return;
  }

  const result = await adSyncService.syncCampaignsFromPlatform(prisma, client, user.companyId, platform);

  await logAudit({
    userId: user.id,
    action: "AD_CAMPAIGNS_SYNCED",
    entityType: "AdAccountConnection",
    entityId: null,
    metadata: { platform, campaignsSynced: result.campaignsSynced, spendRecordsSynced: result.spendRecordsSynced, errorCount: result.errors.length },
    ipAddress: req.ip ?? null,
  });

  res.status(200).json({ configured: true, ...result });
}
