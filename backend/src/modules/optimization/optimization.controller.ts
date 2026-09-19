import type { Request, Response } from "express";
import type { Role } from "@ai-sales/shared";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import * as optimizationService from "./optimization.service.js";
import type { ListOptimizationQuery } from "./optimization.schema.js";

function requireUser(req: Request): { id: string; role: Role; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function list(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const query = req.query as unknown as ListOptimizationQuery;
  const result = await optimizationService.listRecommendations(prisma, companyId, query);
  res.status(200).json({ data: result.items, pagination: { page: result.page, pageSize: result.pageSize, total: result.total } });
}

export async function get(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const recommendation = await optimizationService.getRecommendation(prisma, companyId, req.params.id);
  res.status(200).json(recommendation);
}

export async function generate(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const aiProvider = createAIProvider();
  const now = new Date();

  const result = await optimizationService.generateRecommendations(prisma, aiProvider, user.companyId, now);

  await logAudit({
    userId: user.id,
    action: "OPTIMIZATION_RECOMMENDATIONS_GENERATED",
    entityType: "OptimizationRecommendation",
    entityId: null,
    metadata: { companyId: user.companyId, createdCount: result.created.length, skippedDuplicates: result.skippedDuplicates },
    ipAddress: req.ip ?? null,
  });

  res.status(200).json(result);
}

export async function approve(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const recommendation = await optimizationService.approveRecommendation(prisma, user.companyId, req.params.id, user.id, user.role);
  res.status(200).json(recommendation);
}

export async function reject(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const recommendation = await optimizationService.rejectRecommendation(prisma, user.companyId, req.params.id, user.id);
  res.status(200).json(recommendation);
}
