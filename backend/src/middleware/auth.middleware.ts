import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME } from "../config/constants.js";
import { verifySessionToken } from "../lib/jwt.js";
import { UnauthorizedError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

/**
 * Reads/verifies the `asee_session` JWT cookie, then re-checks the user
 * against the database on every request (rather than trusting the role/
 * active-state baked into the token) and attaches
 * `req.user = { id, role, companyId }` from the fresh DB row.
 *
 * This is deliberate: the app has explicit "deactivate user" and "change
 * role" admin actions, and a 7-day-lived JWT must not let a deactivated or
 * demoted user keep their old access until the token happens to expire.
 * Responds 401 (via next(err)) if the cookie is missing, the token is
 * invalid/expired, or the user no longer exists / is inactive.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;

  if (!token) {
    next(new UnauthorizedError("Authentication required"));
    return;
  }

  try {
    const payload = verifySessionToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, role: true, companyId: true, isActive: true },
    });

    if (!user || !user.isActive) {
      next(new UnauthorizedError("Invalid or expired session"));
      return;
    }

    req.user = {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
    };
    next();
  } catch {
    next(new UnauthorizedError("Invalid or expired session"));
  }
}
