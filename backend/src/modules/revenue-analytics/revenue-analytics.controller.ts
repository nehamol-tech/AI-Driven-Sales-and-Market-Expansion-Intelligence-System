import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import * as revenueAnalyticsService from "./revenue-analytics.service.js";
import type { RevenueAnalyticsQuery } from "./revenue-analytics.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as RevenueAnalyticsQuery;

  const aiProvider = createAIProvider();
  const { dto, wasGenerated, method } = await revenueAnalyticsService.getRevenueAnalytics(prisma, aiProvider, {
    companyId: user.companyId,
    force: query.force,
  });

  if (wasGenerated) {
    await logAudit({
      userId: user.id,
      action: "REVENUE_ANALYTICS_GENERATED",
      entityType: "RevenueAnalytics",
      entityId: null,
      metadata: {
        companyId: user.companyId,
        monthsOfHistory: dto.monthsOfHistory,
        method,
        forced: query.force,
      },
      ipAddress: req.ip ?? null,
    });
  }

  res.status(200).json(dto);
}
