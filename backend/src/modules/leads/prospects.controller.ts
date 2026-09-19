import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { logAudit } from "../audit/audit.service.js";
import * as prospectsService from "./prospects.service.js";
import type { CreateProspectInput, ListProspectsQuery, TriggerProspectScoreInput, UpdateProspectInput } from "./prospects.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function listProspects(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const query = req.query as unknown as ListProspectsQuery;
  const result = await prospectsService.listProspects(prisma, companyId, query);
  res.status(200).json({
    data: result.items,
    pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
  });
}

export async function getProspect(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const detail = await prospectsService.getProspectById(prisma, companyId, req.params.id);
  res.status(200).json(detail);
}

export async function createProspect(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as CreateProspectInput;
  const prospect = await prospectsService.createProspect(prisma, user.companyId, user.id, input);
  await logAudit({
    userId: user.id,
    action: "PROSPECT_CREATE",
    entityType: "Prospect",
    entityId: prospect.id,
    metadata: { businessName: prospect.businessName },
    ipAddress: req.ip ?? null,
  });
  res.status(201).json(prospect);
}

export async function updateProspect(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as UpdateProspectInput;
  const prospect = await prospectsService.updateProspect(prisma, user.companyId, req.params.id, input);
  await logAudit({
    userId: user.id,
    action: "PROSPECT_UPDATE",
    entityType: "Prospect",
    entityId: prospect.id,
    metadata: input,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(prospect);
}

export async function deleteProspect(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await prospectsService.deleteProspect(prisma, user.companyId, req.params.id);
  await logAudit({
    userId: user.id,
    action: "PROSPECT_DELETE",
    entityType: "Prospect",
    entityId: req.params.id,
    ipAddress: req.ip ?? null,
  });
  res.status(204).send();
}

export async function scoreProspect(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as TriggerProspectScoreInput;
  const isPrivilegedCaller = user.role === "ADMIN" || user.role === "MANAGER";

  const result = await prospectsService.triggerProspectScore(prisma, user.companyId, req.params.id, {
    userId: user.id,
    isPrivilegedCaller,
    force: input.force,
    cooldownHours: env.LEAD_RESCORE_COOLDOWN_HOURS,
    ipAddress: req.ip ?? null,
  });

  res.status(200).json(result);
}
