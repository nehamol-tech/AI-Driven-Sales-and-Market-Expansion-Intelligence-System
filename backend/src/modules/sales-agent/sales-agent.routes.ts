import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { leadScoringRateLimiter } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { salesAgentTodayQuerySchema } from "./sales-agent.schema.js";
import * as salesAgentService from "./sales-agent.service.js";
import * as salesAgentController from "./sales-agent.controller.js";

const router = Router();

router.use(requireAuth);

/** Reads the raw (pre-validation) `force` query param as a boolean, without depending on `validate` having run yet. */
export function isForceRequested(req: Request): boolean {
  return req.query.force === "true";
}

/**
 * `force=true` bypasses the cache and always triggers a real AI call, so —
 * mirroring Phase 2's force-rescore RBAC — it's restricted to ADMIN/
 * MANAGER. A plain GET (cache hit, or a normal lazy generate-if-stale) is
 * open to every authenticated role, same risk profile as viewing the
 * existing Leads board. Exported (not just used inline) so it's directly
 * unit-testable the same way requireRole/requireAuth are in
 * tests/middleware/auth.test.ts.
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
 * AI, so it must never count against the limit.
 */
export function rateLimitIfGenerating(req: Request, res: Response, next: NextFunction): void {
  const companyId = req.user?.companyId;
  if (!companyId) {
    next();
    return;
  }
  const force = isForceRequested(req);
  if (salesAgentService.willRequireGeneration(companyId, force)) {
    leadScoringRateLimiter(req, res, next);
    return;
  }
  next();
}

router.get(
  "/today",
  requireRoleIfForce,
  rateLimitIfGenerating,
  validate({ query: salesAgentTodayQuerySchema }),
  asyncHandler(salesAgentController.today),
);

export default router;
