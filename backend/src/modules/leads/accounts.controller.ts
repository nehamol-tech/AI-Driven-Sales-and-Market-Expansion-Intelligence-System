import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import * as accountsService from "./accounts.service.js";
import type { ListAccountsQuery, TriggerScoreInput } from "./accounts.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function listAccounts(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const query = req.query as unknown as ListAccountsQuery;
  const result = await accountsService.listAccounts(prisma, companyId, query);
  res.status(200).json({
    data: result.items,
    pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
  });
}

export async function getAccount(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const detail = await accountsService.getAccountById(prisma, companyId, req.params.id);
  res.status(200).json(detail);
}

export async function scoreAccount(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as TriggerScoreInput;
  const isPrivilegedCaller = user.role === "ADMIN" || user.role === "MANAGER";

  const result = await accountsService.triggerAccountScore(prisma, user.companyId, req.params.id, {
    userId: user.id,
    isPrivilegedCaller,
    force: input.force,
    cooldownHours: env.LEAD_RESCORE_COOLDOWN_HOURS,
    ipAddress: req.ip ?? null,
  });

  res.status(200).json(result);
}
