import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { assistantRateLimiter } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { assistantAskSchema } from "./assistant.schema.js";
import * as assistantController from "./assistant.controller.js";

const router = Router();

router.use(requireAuth);

/**
 * Open to any authenticated role — same risk profile as viewing the
 * dashboard/leads board (read-only, never mutates anything, never triggers
 * a privileged action).
 */
router.post("/ask", assistantRateLimiter, validate({ body: assistantAskSchema }), asyncHandler(assistantController.ask));

export default router;
