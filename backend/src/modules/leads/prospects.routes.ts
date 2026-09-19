import { Router } from "express";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { leadScoringRateLimiter } from "../../middleware/rate-limit.middleware.js";
import {
  listProspectsQuerySchema,
  createProspectSchema,
  updateProspectSchema,
  prospectIdParamSchema,
  triggerProspectScoreSchema,
} from "./prospects.schema.js";
import * as prospectsController from "./prospects.controller.js";

const router = Router();

router.get("/", validate({ query: listProspectsQuerySchema }), asyncHandler(prospectsController.listProspects));

router.get("/:id", validate({ params: prospectIdParamSchema }), asyncHandler(prospectsController.getProspect));

router.post("/", validate({ body: createProspectSchema }), asyncHandler(prospectsController.createProspect));

router.put(
  "/:id",
  validate({ params: prospectIdParamSchema, body: updateProspectSchema }),
  asyncHandler(prospectsController.updateProspect),
);

router.delete(
  "/:id",
  requireRole("ADMIN", "MANAGER"),
  validate({ params: prospectIdParamSchema }),
  asyncHandler(prospectsController.deleteProspect),
);

router.post(
  "/:id/score",
  requireRole("ADMIN", "MANAGER"),
  leadScoringRateLimiter,
  validate({ params: prospectIdParamSchema, body: triggerProspectScoreSchema }),
  asyncHandler(prospectsController.scoreProspect),
);

export default router;
