import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { leadScoringRateLimiter } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import {
  createDistributorSchema,
  distributorExpansionQuerySchema,
  distributorIdParamSchema,
  listDistributorsQuerySchema,
  updateDistributorSchema,
} from "./distributors.schema.js";
import * as distributorExpansionService from "./distributor-expansion.service.js";
import * as distributorsController from "./distributors.controller.js";

const router = Router();

router.use(requireAuth);

/** Reads the raw (pre-validation) `force` query param as a boolean — mirrors market-expansion.routes.ts's isForceRequested exactly. */
export function isForceRequested(req: Request): boolean {
  return req.query.force === "true";
}

/**
 * `force=true` bypasses the cache and always triggers a real AI call, so —
 * mirroring Phase 4/6/7's force-regenerate RBAC exactly — it's restricted to
 * ADMIN/MANAGER. A plain GET (cache hit, or a normal lazy generate-if-stale)
 * is open to every authenticated role.
 */
export function requireRoleIfForce(req: Request, res: Response, next: NextFunction): void {
  if (!isForceRequested(req)) {
    next();
    return;
  }
  requireRole("ADMIN", "MANAGER")(req, res, next);
}

/** Only applies the AI-cost rate limiter to requests that will actually trigger generation (cache miss or force=true) — mirrors market-expansion.routes.ts's rateLimitIfGenerating exactly. */
export function rateLimitIfGenerating(req: Request, res: Response, next: NextFunction): void {
  const companyId = req.user?.companyId;
  if (!companyId) {
    next();
    return;
  }
  const force = isForceRequested(req);
  if (distributorExpansionService.willRequireGeneration(companyId, force)) {
    leadScoringRateLimiter(req, res, next);
    return;
  }
  next();
}

// Mounted before the `/:id` routes so "expansion" is never captured as an id param.
router.get(
  "/expansion",
  requireRoleIfForce,
  rateLimitIfGenerating,
  validate({ query: distributorExpansionQuerySchema }),
  asyncHandler(distributorsController.getExpansionSummary),
);

router.get("/", validate({ query: listDistributorsQuerySchema }), asyncHandler(distributorsController.listDistributors));

router.post("/", validate({ body: createDistributorSchema }), asyncHandler(distributorsController.createDistributor));

router.get("/:id", validate({ params: distributorIdParamSchema }), asyncHandler(distributorsController.getDistributor));

router.put(
  "/:id",
  validate({ params: distributorIdParamSchema, body: updateDistributorSchema }),
  asyncHandler(distributorsController.updateDistributor),
);

// Matches Prospect/FollowUp/AdCampaign's delete precedent exactly.
router.delete(
  "/:id",
  requireRole("ADMIN", "MANAGER"),
  validate({ params: distributorIdParamSchema }),
  asyncHandler(distributorsController.deleteDistributor),
);

export default router;
