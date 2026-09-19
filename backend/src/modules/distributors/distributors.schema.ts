import { z } from "zod";
import { DISTRIBUTOR_STATUSES, DISTRIBUTOR_TYPES } from "@ai-sales/shared";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants.js";

const isoDate = z.union([z.string(), z.date()]).transform((v) => new Date(v));

export const listDistributorsQuerySchema = z.object({
  type: z.enum(DISTRIBUTOR_TYPES).optional(),
  status: z.enum(DISTRIBUTOR_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListDistributorsQuery = z.infer<typeof listDistributorsQuerySchema>;

/** Any authenticated role may create a Distributor — matches Prospect/SalesRecord/AdCampaign's creation precedent. */
export const createDistributorSchema = z.object({
  name: z.string().trim().min(1, "Distributor name is required").max(300),
  type: z.enum(DISTRIBUTOR_TYPES),
  status: z.enum(DISTRIBUTOR_STATUSES).default("PROSPECTIVE"),
  contactEmail: z.string().trim().email().max(300).nullable().optional().or(z.literal("").transform(() => null)),
  contactPhone: z.string().trim().max(50).nullable().optional(),
  assignedUserId: z.string().trim().min(1).nullable().optional(),
  onboardedAt: isoDate.nullable().optional(),
  stateIds: z.array(z.string().trim().min(1)).default([]),
});
export type CreateDistributorInput = z.infer<typeof createDistributorSchema>;

export const updateDistributorSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  type: z.enum(DISTRIBUTOR_TYPES).optional(),
  status: z.enum(DISTRIBUTOR_STATUSES).optional(),
  contactEmail: z.string().trim().email().max(300).nullable().optional().or(z.literal("").transform(() => null)),
  contactPhone: z.string().trim().max(50).nullable().optional(),
  assignedUserId: z.string().trim().min(1).nullable().optional(),
  onboardedAt: isoDate.nullable().optional(),
  // Omitting stateIds leaves the existing territory set untouched; an empty
  // array explicitly clears it. Distinguished by `undefined` vs `[]` — the
  // service layer only replaces territories when this key is present.
  stateIds: z.array(z.string().trim().min(1)).optional(),
});
export type UpdateDistributorInput = z.infer<typeof updateDistributorSchema>;

export const distributorIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const distributorExpansionQuerySchema = z.object({
  force: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false" as const),
});
export type DistributorExpansionQuery = z.infer<typeof distributorExpansionQuerySchema>;
