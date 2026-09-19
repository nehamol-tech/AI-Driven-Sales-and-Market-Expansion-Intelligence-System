import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { NotFoundError, UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import * as marketExpansionService from "./market-expansion.service.js";
import type { MarketExpansionForceQuery, MarketExpansionQuery } from "./market-expansion.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as MarketExpansionQuery;

  const aiProvider = createAIProvider();
  const { dto, wasGenerated, method } = await marketExpansionService.getMarketExpansionSummary(prisma, aiProvider, {
    companyId: user.companyId,
    limit: query.limit,
    force: query.force,
  });

  if (wasGenerated) {
    await logAudit({
      userId: user.id,
      action: "MARKET_EXPANSION_GENERATED",
      entityType: "MarketExpansionSummary",
      entityId: null,
      metadata: {
        companyId: user.companyId,
        totalStatesWithData: dto.totalStatesWithData,
        totalStatesAnalyzed: dto.totalStatesAnalyzed,
        narratedCount: dto.markets.length,
        method,
        forced: query.force,
      },
      ipAddress: req.ip ?? null,
    });
  }

  res.status(200).json(dto);
}

export async function detail(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as MarketExpansionForceQuery;

  const aiProvider = createAIProvider();
  const { dto, wasGenerated, method } = await marketExpansionService.getMarketDetail(prisma, aiProvider, {
    companyId: user.companyId,
    stateId: req.params.stateId,
    force: query.force,
  });

  if (!dto) {
    throw new NotFoundError("State not found");
  }

  if (wasGenerated) {
    await logAudit({
      userId: user.id,
      action: "MARKET_EXPANSION_GENERATED",
      entityType: "MarketExpansionSummary",
      entityId: null,
      metadata: {
        companyId: user.companyId,
        method,
        forced: query.force,
        triggeredByStateId: req.params.stateId,
      },
      ipAddress: req.ip ?? null,
    });
  }

  res.status(200).json(dto);
}
