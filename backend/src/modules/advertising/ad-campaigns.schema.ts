import { z } from "zod";
import { AD_PLATFORMS } from "@ai-sales/shared";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants.js";

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), { message: "Must be a valid decimal number with up to 2 decimal places" });

const isoDate = z.union([z.string(), z.date()]).transform((v) => new Date(v));

export const listCampaignsQuerySchema = z.object({
  platform: z.enum(AD_PLATFORMS).optional(),
  isActive: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required").max(300),
  platform: z.enum(AD_PLATFORMS),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
  isActive: z.boolean().default(true),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const campaignIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const createSpendRecordSchema = z.object({
  date: isoDate,
  amount: decimalString,
  impressions: z.coerce.number().int().min(0).nullable().optional(),
  clicks: z.coerce.number().int().min(0).nullable().optional(),
});
export type CreateSpendRecordInput = z.infer<typeof createSpendRecordSchema>;

export const spendRecordIdParamSchema = z.object({
  id: z.string().trim().min(1),
  spendId: z.string().trim().min(1),
});
