import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { validate } from "../../middleware/validate.middleware.js";
import { salesTrendQuerySchema } from "./dashboard.schema.js";
import * as dashboardController from "./dashboard.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/overview", asyncHandler(dashboardController.overview));

router.get("/insights", asyncHandler(dashboardController.insights));

router.get("/sales-trend", validate({ query: salesTrendQuerySchema }), asyncHandler(dashboardController.salesTrend));

export default router;
