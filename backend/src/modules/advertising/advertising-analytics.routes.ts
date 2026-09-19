import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { leadScoringRateLimiter } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { advertisingAnalyticsQuerySchema } from "./advertising-analytics.schema.js";
import * as advertisingAnalyticsService from "./advertising-analytics.service.js";
import * as advertisingAnalyticsController from "./advertising-analytics.controller.js";

const router = Router();

router.use(requireAuth);

/** Reads the raw (pre-validation) `force` query param as a boolean — mirrors revenue-analytics.routes.ts's isForceRequested exactly. */
export function isForceRequested(req: Request): boolean {
  return req.query.force === "true";
}

/**
 * `force=true` bypasses the cache and always triggers a real AI call, so —
 * mirroring revenue-analytics.routes.ts's force-regenerate RBAC exactly —
 * it's restricted to ADMIN/MANAGER. A plain GET is open to every
 * authenticated role.
 */
export function requireRoleIfForce(req: Request, res: Response, next: NextFunction): void {
  if (!isForceRequested(req)) {
    next();
    return;
  }
  requireRole("ADMIN", "MANAGER")(req, res, next);
}

/** Only applies the AI-cost rate limiter to requests that will actually trigger generation (cache miss or force=true) — mirrors revenue-analytics.routes.ts's rateLimitIfGenerating exactly. */
export function rateLimitIfGenerating(req: Request, res: Response, next: NextFunction): void {
  const companyId = req.user?.companyId;
  if (!companyId) {
    next();
    return;
  }
  const force = isForceRequested(req);
  if (advertisingAnalyticsService.willRequireGeneration(companyId, force)) {
    leadScoringRateLimiter(req, res, next);
    return;
  }
  next();
}

router.get(
  "/",
  requireRoleIfForce,
  rateLimitIfGenerating,
  validate({ query: advertisingAnalyticsQuerySchema }),
  asyncHandler(advertisingAnalyticsController.getSummary),
);

export default router;
