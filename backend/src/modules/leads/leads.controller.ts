import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { logAudit } from "../audit/audit.service.js";
import * as leadsService from "./leads.service.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function summary(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const result = await leadsService.getLeadSummary(prisma, companyId);
  res.status(200).json(result);
}

export async function scoreBatch(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const isPrivilegedCaller = user.role === "ADMIN" || user.role === "MANAGER";

  const results = await leadsService.runBatchScoring(prisma, user.companyId, {
    userId: user.id,
    isPrivilegedCaller,
    cooldownHours: env.LEAD_RESCORE_COOLDOWN_HOURS,
    ipAddress: req.ip ?? null,
  });

  await logAudit({
    userId: user.id,
    action: "LEAD_SCORE_BATCH_COMPUTED",
    entityType: "LeadScore",
    entityId: null,
    metadata: { count: results.length },
    ipAddress: req.ip ?? null,
  });

  res.status(200).json({ data: results });
}
