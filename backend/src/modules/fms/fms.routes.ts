import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { fmsDataQuerySchema } from "./fms.schema.js";
import * as fmsController from "./fms.controller.js";

const router = Router();

router.use(requireAuth);

// Read-only proxy to the FMS Google Sheet via its Apps Script Web App — same
// risk profile as viewing any other read-only dashboard/analytics endpoint,
// so it's open to every authenticated role (mirrors ad-connections.routes.ts's
// GET / precedent: "Open to every authenticated role — same risk profile as
// viewing any other read-only dashboard").
router.get("/data", validate({ query: fmsDataQuerySchema }), asyncHandler(fmsController.getData));

export default router;
