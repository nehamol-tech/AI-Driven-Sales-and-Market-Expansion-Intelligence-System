import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { leadScoringRateLimiter } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { listOptimizationQuerySchema, recommendationIdParamSchema } from "./optimization.schema.js";
import * as optimizationController from "./optimization.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", validate({ query: listOptimizationQuerySchema }), asyncHandler(optimizationController.list));

router.get("/:id", validate({ params: recommendationIdParamSchema }), asyncHandler(optimizationController.get));

/**
 * POST /generate always does real detection work when reached (there is no
 * "cache hit" concept here — recommendations persist rather than being
 * cached and re-served) — so, unlike the cached-narrative endpoints
 * elsewhere in this codebase, the AI-cost rate limiter is applied
 * unconditionally rather than only when generation would actually occur.
 */
router.post("/generate", requireRole("ADMIN", "MANAGER"), leadScoringRateLimiter, asyncHandler(optimizationController.generate));

router.post("/:id/approve", requireRole("ADMIN", "MANAGER"), validate({ params: recommendationIdParamSchema }), asyncHandler(optimizationController.approve));

router.post("/:id/reject", requireRole("ADMIN", "MANAGER"), validate({ params: recommendationIdParamSchema }), asyncHandler(optimizationController.reject));

export default router;
