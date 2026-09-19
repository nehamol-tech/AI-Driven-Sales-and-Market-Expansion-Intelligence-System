import jwt from "jsonwebtoken";
import type { Role } from "@ai-sales/shared";
import { env } from "../config/env.js";

export interface SessionTokenPayload {
  userId: string;
  role: Role;
  companyId: string;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" });
}

export function verifySessionToken(token: string): SessionTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || !decoded) {
    throw new Error("Invalid token payload");
  }
  const { userId, role, companyId } = decoded as Record<string, unknown>;
  if (typeof userId !== "string" || typeof role !== "string" || typeof companyId !== "string") {
    throw new Error("Invalid token payload");
  }
  return { userId, role: role as Role, companyId };
}
