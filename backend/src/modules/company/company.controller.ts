import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { logAudit } from "../audit/audit.service.js";
import * as companyService from "./company.service.js";
import type { UpdateCompanyInput, OperatingStateInput, TargetStateInput } from "./company.schema.js";

function requireCompanyId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user.companyId;
}

export async function getCompany(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const company = await companyService.getCompany(prisma, companyId);
  res.status(200).json(company);
}

export async function updateCompany(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const input = req.body as UpdateCompanyInput;
  const company = await companyService.updateCompany(prisma, companyId, input);
  await logAudit({
    userId: req.user?.id,
    action: "COMPANY_UPDATE",
    entityType: "Company",
    entityId: companyId,
    metadata: input,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(company);
}

export async function addOperatingState(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const { stateId } = req.body as OperatingStateInput;
  const company = await companyService.addOperatingState(prisma, companyId, stateId);
  await logAudit({
    userId: req.user?.id,
    action: "COMPANY_ADD_OPERATING_STATE",
    entityType: "Company",
    entityId: companyId,
    metadata: { stateId },
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(company);
}

export async function removeOperatingState(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const { stateId } = req.body as OperatingStateInput;
  const company = await companyService.removeOperatingState(prisma, companyId, stateId);
  await logAudit({
    userId: req.user?.id,
    action: "COMPANY_REMOVE_OPERATING_STATE",
    entityType: "Company",
    entityId: companyId,
    metadata: { stateId },
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(company);
}

export async function addTargetState(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const { stateId, notes } = req.body as TargetStateInput;
  const company = await companyService.addTargetState(prisma, companyId, stateId, notes);
  await logAudit({
    userId: req.user?.id,
    action: "COMPANY_ADD_TARGET_STATE",
    entityType: "Company",
    entityId: companyId,
    metadata: { stateId, notes },
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(company);
}

export async function removeTargetState(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const { stateId } = req.body as OperatingStateInput;
  const company = await companyService.removeTargetState(prisma, companyId, stateId);
  await logAudit({
    userId: req.user?.id,
    action: "COMPANY_REMOVE_TARGET_STATE",
    entityType: "Company",
    entityId: companyId,
    metadata: { stateId },
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(company);
}
