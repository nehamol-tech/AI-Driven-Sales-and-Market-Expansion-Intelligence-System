import type { Request, Response } from "express";
import type { AdvertisingSummaryDTO } from "@ai-sales/shared";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import * as adConnectionsService from "./ad-connections.service.js";
import * as advertisingAnalyticsService from "./advertising-analytics.service.js";
import type { AdvertisingAnalyticsQuery } from "./advertising-analytics.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function getSummary(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as AdvertisingAnalyticsQuery;

  const aiProvider = createAIProvider();

  // `connections` is a live, uncached read (see advertising-analytics.service.ts's
  // top comment for why) — only `campaigns`/`narrative` follow the daily
  // cache/force gate.
  const [connections, analytics] = await Promise.all([
    adConnectionsService.getConnections(prisma, user.companyId),
    advertisingAnalyticsService.getAdvertisingAnalytics(prisma, aiProvider, { companyId: user.companyId, force: query.force }),
  ]);

  if (analytics.wasGenerated) {
    await logAudit({
      userId: user.id,
      action: "ADVERTISING_ANALYTICS_GENERATED",
      entityType: "AdvertisingAnalytics",
      entityId: null,
      metadata: { companyId: user.companyId, campaignCount: analytics.campaigns.length, method: analytics.method, forced: query.force },
      ipAddress: req.ip ?? null,
    });
  }

  const dto: AdvertisingSummaryDTO = {
    generatedAt: new Date().toISOString(),
    connections,
    campaigns: analytics.campaigns,
    narrative: analytics.narrative,
    narrativeMethod: analytics.method,
  };

  res.status(200).json(dto);
}
