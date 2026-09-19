import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import * as distributorsService from "./distributors.service.js";
import * as distributorExpansionService from "./distributor-expansion.service.js";
import type { CreateDistributorInput, DistributorExpansionQuery, ListDistributorsQuery, UpdateDistributorInput } from "./distributors.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function listDistributors(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const query = req.query as unknown as ListDistributorsQuery;
  const result = await distributorsService.listDistributors(prisma, companyId, query);
  res.status(200).json({ data: result.items, pagination: { page: result.page, pageSize: result.pageSize, total: result.total } });
}

export async function getDistributor(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const distributor = await distributorsService.getDistributor(prisma, companyId, req.params.id);
  res.status(200).json(distributor);
}

export async function createDistributor(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as CreateDistributorInput;
  const distributor = await distributorsService.createDistributor(prisma, user.companyId, user.id, input);
  await logAudit({
    userId: user.id,
    action: "DISTRIBUTOR_CREATE",
    entityType: "Distributor",
    entityId: distributor.id,
    metadata: { name: distributor.name, type: distributor.type },
    ipAddress: req.ip ?? null,
  });
  res.status(201).json(distributor);
}

export async function updateDistributor(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as UpdateDistributorInput;
  const distributor = await distributorsService.updateDistributor(prisma, user.companyId, req.params.id, input);
  await logAudit({
    userId: user.id,
    action: "DISTRIBUTOR_UPDATE",
    entityType: "Distributor",
    entityId: distributor.id,
    metadata: input,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(distributor);
}

export async function deleteDistributor(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await distributorsService.deleteDistributor(prisma, user.companyId, req.params.id);
  await logAudit({
    userId: user.id,
    action: "DISTRIBUTOR_DELETE",
    entityType: "Distributor",
    entityId: req.params.id,
    ipAddress: req.ip ?? null,
  });
  res.status(204).send();
}

export async function getExpansionSummary(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as DistributorExpansionQuery;

  const aiProvider = createAIProvider();
  const result = await distributorExpansionService.getDistributorExpansionSummary(prisma, aiProvider, {
    companyId: user.companyId,
    force: query.force,
  });

  if (result.wasGenerated) {
    await logAudit({
      userId: user.id,
      action: "DISTRIBUTOR_EXPANSION_GENERATED",
      entityType: "DistributorExpansionSummary",
      entityId: null,
      metadata: {
        companyId: user.companyId,
        recommendationCount: result.recommendations.length,
        distributorCount: result.performance.length,
        method: result.narrativeMethod,
        forced: query.force,
      },
      ipAddress: req.ip ?? null,
    });
  }

  res.status(200).json({
    generatedAt: new Date().toISOString(),
    recommendations: result.recommendations,
    performance: result.performance,
    narrative: result.narrative,
    narrativeMethod: result.narrativeMethod,
  });
}
