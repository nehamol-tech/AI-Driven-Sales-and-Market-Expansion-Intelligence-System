import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { setSessionCookie, clearSessionCookie } from "../../lib/cookies.js";
import { toUserDTO } from "../../lib/dto.js";
import { NotFoundError, UnauthorizedError } from "../../lib/errors.js";
import { logAudit } from "../audit/audit.service.js";
import { bootstrapCompany, authenticateUser, getUserById, isBootstrapped } from "./auth.service.js";
import type { BootstrapInput, LoginInput } from "./auth.schema.js";

export async function bootstrapStatus(_req: Request, res: Response): Promise<void> {
  const bootstrapped = await isBootstrapped(prisma);
  res.status(200).json({ bootstrapped });
}

export async function bootstrap(req: Request, res: Response): Promise<void> {
  const input = req.body as BootstrapInput;
  const { user, token } = await bootstrapCompany(prisma, input);

  setSessionCookie(res, token);
  await logAudit({
    userId: user.id,
    action: "AUTH_BOOTSTRAP",
    entityType: "Company",
    entityId: user.companyId,
    ipAddress: req.ip ?? null,
  });

  res.status(201).json(toUserDTO(user));
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = req.body as LoginInput;
  const { user, token } = await authenticateUser(prisma, input);

  setSessionCookie(res, token);
  await logAudit({
    userId: user.id,
    action: "AUTH_LOGIN",
    entityType: "User",
    entityId: user.id,
    ipAddress: req.ip ?? null,
  });

  res.status(200).json(toUserDTO(user));
}

export function logout(req: Request, res: Response): void {
  clearSessionCookie(res);
  void logAudit({
    userId: req.user?.id ?? null,
    action: "AUTH_LOGOUT",
    entityType: "User",
    entityId: req.user?.id ?? null,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json({ success: true });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  const user = await getUserById(prisma, req.user.id);
  if (!user) {
    throw new NotFoundError("User not found");
  }
  res.status(200).json(toUserDTO(user));
}
