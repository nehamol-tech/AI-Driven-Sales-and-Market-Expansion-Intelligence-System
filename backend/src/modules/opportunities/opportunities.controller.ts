import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import * as opportunitiesService from "./opportunities.service.js";
import type { OpportunitiesQuery } from "./opportunities.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as OpportunitiesQuery;

  const aiProvider = createAIProvider();
  const { dto, wasGenerated, method } = await opportunitiesService.getOpportunities(prisma, aiProvider, {
    companyId: user.companyId,
    limit: query.limit,
    force: query.force,
    type: query.type,
    priority: query.priority,
  });

  if (wasGenerated) {
    await logAudit({
      userId: user.id,
      action: "OPPORTUNITIES_GENERATED",
      entityType: "OpportunitySummary",
      entityId: null,
      metadata: {
        companyId: user.companyId,
        counts: dto.counts,
        totalOpportunities: dto.totalOpportunities,
        highPriorityCount: dto.highPriorityCount,
        narratedCount: dto.opportunities.length,
        method,
        forced: query.force,
      },
      ipAddress: req.ip ?? null,
    });
  }

  res.status(200).json(dto);
}
