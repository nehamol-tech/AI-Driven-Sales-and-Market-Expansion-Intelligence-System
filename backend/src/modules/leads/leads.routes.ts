import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { leadScoringRateLimiter } from "../../middleware/rate-limit.middleware.js";
import accountsRoutes from "./accounts.routes.js";
import prospectsRoutes from "./prospects.routes.js";
import { leadFeedbackParamSchema, submitFeedbackSchema } from "./feedback.schema.js";
import * as feedbackController from "./feedback.controller.js";
import * as leadsController from "./leads.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/summary", asyncHandler(leadsController.summary));

router.post("/score-batch", requireRole("ADMIN", "MANAGER"), leadScoringRateLimiter, asyncHandler(leadsController.scoreBatch));

router.post(
  "/:leadType/:id/feedback",
  validate({ params: leadFeedbackParamSchema, body: submitFeedbackSchema }),
  asyncHandler(feedbackController.submitFeedback),
);

router.use("/accounts", accountsRoutes);
router.use("/prospects", prospectsRoutes);

export default router;
