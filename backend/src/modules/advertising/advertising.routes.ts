import { Router } from "express";
import adConnectionsRoutes from "./ad-connections.routes.js";
import adCampaignsRoutes from "./ad-campaigns.routes.js";
import advertisingAnalyticsRoutes from "./advertising-analytics.routes.js";

/**
 * Combines the three advertising sub-routers under one export. Mounted at
 * `/api/advertising` in app.ts, so the final public paths are exactly:
 *   /api/advertising/connections...
 *   /api/advertising/campaigns...
 *   /api/advertising/analytics
 */
const router = Router();

router.use("/connections", adConnectionsRoutes);
router.use("/campaigns", adCampaignsRoutes);
router.use("/analytics", advertisingAnalyticsRoutes);

export default router;
