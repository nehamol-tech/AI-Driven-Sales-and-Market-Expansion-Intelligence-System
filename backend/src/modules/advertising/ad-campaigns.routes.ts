import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import {
  listCampaignsQuerySchema,
  createCampaignSchema,
  updateCampaignSchema,
  campaignIdParamSchema,
  createSpendRecordSchema,
  spendRecordIdParamSchema,
} from "./ad-campaigns.schema.js";
import * as adCampaignsController from "./ad-campaigns.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", validate({ query: listCampaignsQuerySchema }), asyncHandler(adCampaignsController.listCampaigns));

router.post("/", validate({ body: createCampaignSchema }), asyncHandler(adCampaignsController.createCampaign));

router.get("/:id", validate({ params: campaignIdParamSchema }), asyncHandler(adCampaignsController.getCampaign));

router.put(
  "/:id",
  validate({ params: campaignIdParamSchema, body: updateCampaignSchema }),
  asyncHandler(adCampaignsController.updateCampaign),
);

// Matches Prospect/FollowUp's delete precedent exactly.
router.delete("/:id", requireRole("ADMIN", "MANAGER"), validate({ params: campaignIdParamSchema }), asyncHandler(adCampaignsController.deleteCampaign));

router.get("/:id/spend", validate({ params: campaignIdParamSchema }), asyncHandler(adCampaignsController.listSpendRecords));

router.post(
  "/:id/spend",
  validate({ params: campaignIdParamSchema, body: createSpendRecordSchema }),
  asyncHandler(adCampaignsController.createSpendRecord),
);

router.delete(
  "/:id/spend/:spendId",
  requireRole("ADMIN", "MANAGER"),
  validate({ params: spendRecordIdParamSchema }),
  asyncHandler(adCampaignsController.deleteSpendRecord),
);

export default router;
