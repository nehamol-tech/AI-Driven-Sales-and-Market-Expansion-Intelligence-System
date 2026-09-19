import { z } from "zod";
import { LEAD_CLASSIFICATIONS, PROSPECT_STATUSES } from "@ai-sales/shared";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants.js";

export const listProspectsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: z.enum(PROSPECT_STATUSES).optional(),
  classification: z.enum(LEAD_CLASSIFICATIONS).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  hasScore: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  assignedUserId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListProspectsQuery = z.infer<typeof listProspectsQuerySchema>;

export const createProspectSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(300),
  industryId: z.string().trim().min(1).nullable().optional(),
  businessTypeId: z.string().trim().min(1).nullable().optional(),
  stateId: z.string().trim().min(1).nullable().optional(),
  cityId: z.string().trim().min(1).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  contactEmail: z.string().trim().email().max(300).nullable().optional().or(z.literal("").transform(() => null)),
  contactPhone: z.string().trim().max(50).nullable().optional(),
  status: z.enum(PROSPECT_STATUSES).default("NEW"),
  assignedUserId: z.string().trim().min(1).nullable().optional(),
  productIds: z.array(z.string().trim().min(1)).default([]),
  // Phase 7: optional attribution to an AdCampaign — powers
  // advertising-analytics.service.ts's leadsGenerated/leadsWon counts. Purely
  // additive; omitting it leaves the prospect unattributed exactly as before.
  campaignId: z.string().trim().min(1).nullable().optional(),
});
export type CreateProspectInput = z.infer<typeof createProspectSchema>;

export const updateProspectSchema = z.object({
  businessName: z.string().trim().min(1).max(300).optional(),
  industryId: z.string().trim().min(1).nullable().optional(),
  businessTypeId: z.string().trim().min(1).nullable().optional(),
  stateId: z.string().trim().min(1).nullable().optional(),
  cityId: z.string().trim().min(1).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  contactEmail: z.string().trim().email().max(300).nullable().optional().or(z.literal("").transform(() => null)),
  contactPhone: z.string().trim().max(50).nullable().optional(),
  status: z.enum(PROSPECT_STATUSES).optional(),
  assignedUserId: z.string().trim().min(1).nullable().optional(),
  productIds: z.array(z.string().trim().min(1)).optional(),
  campaignId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateProspectInput = z.infer<typeof updateProspectSchema>;

export const prospectIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const triggerProspectScoreSchema = z.object({
  force: z.boolean().default(false),
});
export type TriggerProspectScoreInput = z.infer<typeof triggerProspectScoreSchema>;
