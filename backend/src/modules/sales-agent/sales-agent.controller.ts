import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import * as salesAgentService from "./sales-agent.service.js";
import type { SalesAgentTodayQuery } from "./sales-agent.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function today(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as SalesAgentTodayQuery;

  const aiProvider = createAIProvider();
  const { dto, wasGenerated } = await salesAgentService.getSalesAgentToday(prisma, aiProvider, {
    companyId: user.companyId,
    limit: query.limit,
    force: query.force,
  });

  if (wasGenerated) {
    const method = dto.priorities[0]?.narrativeMethod ?? null;
    await logAudit({
      userId: user.id,
      action: "SALES_AGENT_DAILY_BRIEFING_GENERATED",
      entityType: "SalesAgentBriefing",
      entityId: null,
      metadata: {
        companyId: user.companyId,
        totalCandidates: dto.totalCandidates,
        narratedCount: dto.priorities.length,
        method,
        forced: query.force,
      },
      ipAddress: req.ip ?? null,
    });
  }

  res.status(200).json(dto);
}
