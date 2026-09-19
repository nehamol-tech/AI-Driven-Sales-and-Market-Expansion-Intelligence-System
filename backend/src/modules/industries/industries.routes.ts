import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import * as industriesController from "./industries.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/industries", asyncHandler(industriesController.listIndustries));
router.get("/business-types", asyncHandler(industriesController.listBusinessTypes));

export default router;
