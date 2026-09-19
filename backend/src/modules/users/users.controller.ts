import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { toUserDTO } from "../../lib/dto.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { logAudit } from "../audit/audit.service.js";
import * as usersService from "./users.service.js";
import type { CreateUserInput, UpdateUserInput } from "./users.schema.js";

function requireCompanyId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user.companyId;
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const users = await usersService.listUsers(prisma, companyId);
  res.status(200).json(users.map(toUserDTO));
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const input = req.body as CreateUserInput;
  const user = await usersService.createUser(prisma, companyId, input);
  await logAudit({
    userId: req.user?.id,
    action: "USER_CREATE",
    entityType: "User",
    entityId: user.id,
    metadata: { email: user.email, role: user.role },
    ipAddress: req.ip ?? null,
  });
  res.status(201).json(toUserDTO(user));
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const { id } = req.params;
  const input = req.body as UpdateUserInput;
  const user = await usersService.updateUser(prisma, companyId, id, input);
  await logAudit({
    userId: req.user?.id,
    action: "USER_UPDATE",
    entityType: "User",
    entityId: user.id,
    metadata: input,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(toUserDTO(user));
}

export async function deactivateUser(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const { id } = req.params;
  const user = await usersService.deactivateUser(prisma, companyId, id);
  await logAudit({
    userId: req.user?.id,
    action: "USER_DEACTIVATE",
    entityType: "User",
    entityId: user.id,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(toUserDTO(user));
}
