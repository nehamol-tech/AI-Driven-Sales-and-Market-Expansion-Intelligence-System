import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { listFollowUpsQuerySchema, createFollowUpSchema, updateFollowUpSchema, followUpIdParamSchema } from "./follow-ups.schema.js";
import * as followUpsController from "./follow-ups.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", validate({ query: listFollowUpsQuerySchema }), asyncHandler(followUpsController.listFollowUps));

router.post("/", validate({ body: createFollowUpSchema }), asyncHandler(followUpsController.createFollowUp));

router.put(
  "/:id",
  validate({ params: followUpIdParamSchema, body: updateFollowUpSchema }),
  asyncHandler(followUpsController.updateFollowUp),
);

// Delete is restricted to ADMIN/MANAGER — mirrors prospects.routes.ts's exact requireRole("ADMIN", "MANAGER") pattern.
router.delete(
  "/:id",
  requireRole("ADMIN", "MANAGER"),
  validate({ params: followUpIdParamSchema }),
  asyncHandler(followUpsController.deleteFollowUp),
);

export default router;
