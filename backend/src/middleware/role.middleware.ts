import type { NextFunction, Request, Response } from "express";
import type { Role } from "@ai-sales/shared";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";

/**
 * Restricts a route to the given roles. ADMIN implicitly passes every
 * `requireRole` check regardless of the list given, since admins can do
 * everything.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError("Authentication required"));
      return;
    }

    if (req.user.role === "ADMIN" || roles.includes(req.user.role)) {
      next();
      return;
    }

    next(new ForbiddenError("You do not have permission to perform this action"));
  };
}
