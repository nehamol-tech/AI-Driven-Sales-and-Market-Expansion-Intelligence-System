import type { Request, Response } from "express";
import type { Role } from "@ai-sales/shared";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { logAudit } from "../audit/audit.service.js";
import * as followUpsService from "./follow-ups.service.js";
import type { CreateFollowUpInput, ListFollowUpsQuery, UpdateFollowUpInput } from "./follow-ups.schema.js";

function requireUser(req: Request): { id: string; role: Role; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function listFollowUps(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const query = req.query as unknown as ListFollowUpsQuery;
  const summary = await followUpsService.listFollowUps(prisma, companyId, {
    status: query.status,
    dueBy: query.dueBy,
    leadType: query.leadType,
    limit: query.limit,
  });
  res.status(200).json(summary);
}

export async function createFollowUp(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as CreateFollowUpInput;
  const followUp = await followUpsService.createFollowUp(prisma, user.companyId, user.id, user.role, input);
  await logAudit({
    userId: user.id,
    action: "FOLLOW_UP_CREATED",
    entityType: "FollowUp",
    entityId: followUp.id,
    metadata: { leadId: followUp.leadId, leadType: followUp.leadType, dueDate: followUp.dueDate, assignedUserId: followUp.assignedUserId },
    ipAddress: req.ip ?? null,
  });
  res.status(201).json(followUp);
}

export async function updateFollowUp(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as UpdateFollowUpInput;
  const followUp = await followUpsService.updateFollowUp(prisma, user.companyId, req.params.id, input);

  if (input.status === "COMPLETED" || input.status === "CANCELLED") {
    await logAudit({
      userId: user.id,
      action: input.status === "COMPLETED" ? "FOLLOW_UP_COMPLETED" : "FOLLOW_UP_CANCELLED",
      entityType: "FollowUp",
      entityId: followUp.id,
      metadata: { status: followUp.status, completedAt: followUp.completedAt },
      ipAddress: req.ip ?? null,
    });
  }

  res.status(200).json(followUp);
}

export async function deleteFollowUp(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await followUpsService.deleteFollowUp(prisma, user.companyId, req.params.id);
  await logAudit({
    userId: user.id,
    action: "FOLLOW_UP_DELETED",
    entityType: "FollowUp",
    entityId: req.params.id,
    ipAddress: req.ip ?? null,
  });
  res.status(204).send();
}
