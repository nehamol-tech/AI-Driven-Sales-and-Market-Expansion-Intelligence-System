import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { leadScoringRateLimiter } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { revenueAnalyticsQuerySchema } from "./revenue-analytics.schema.js";
import * as revenueAnalyticsService from "./revenue-analytics.service.js";
import * as revenueAnalyticsController from "./revenue-analytics.controller.js";

const router = Router();

router.use(requireAuth);

/** Reads the raw (pre-validation) `force` query param as a boolean, without depending on `validate` having run yet. Mirrors market-expansion.routes.ts's isForceRequested exactly. */
export function isForceRequested(req: Request): boolean {
  return req.query.force === "true";
}

/**
 * `force=true` bypasses the cache and always triggers a real AI call, so —
 * mirroring market-expansion.routes.ts's force-regenerate RBAC exactly —
 * it's restricted to ADMIN/MANAGER. A plain GET (cache hit, or a normal
 * lazy generate-if-stale) is open to every authenticated role, same risk
 * profile as viewing the existing dashboard / Leads board / today's
 * priorities.
 */
export function requireRoleIfForce(req: Request, res: Response, next: NextFunction): void {
  if (!isForceRequested(req)) {
    next();
    return;
  }
  requireRole("ADMIN", "MANAGER")(req, res, next);
}

/**
 * Only applies the AI-cost rate limiter to requests that will actually
 * trigger generation (cache miss or force=true) — a cache hit never calls
 * AI, so it must never count against the limit. Reuses `leadScoringRateLimiter`
 * for the same reason market-expansion.routes.ts does: identical cost
 * profile (at most one AI call per company per day, or on an explicit
 * force), so a dedicated limiter would just duplicate the same budget.
 */
export function rateLimitIfGenerating(req: Request, res: Response, next: NextFunction): void {
  const companyId = req.user?.companyId;
  if (!companyId) {
    next();
    return;
  }
  const force = isForceRequested(req);
  if (revenueAnalyticsService.willRequireGeneration(companyId, force)) {
    leadScoringRateLimiter(req, res, next);
    return;
  }
  next();
}

router.get(
  "/",
  requireRoleIfForce,
  rateLimitIfGenerating,
  validate({ query: revenueAnalyticsQuerySchema }),
  asyncHandler(revenueAnalyticsController.list),
);

export default router;
