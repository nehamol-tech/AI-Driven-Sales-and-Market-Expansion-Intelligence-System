import { z } from "zod";
import { LEAD_CLASSIFICATIONS } from "@ai-sales/shared";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants.js";

export const listAccountsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  classification: z.enum(LEAD_CLASSIFICATIONS).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  hasScore: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

export const accountIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const triggerScoreSchema = z.object({
  force: z.boolean().default(false),
});
export type TriggerScoreInput = z.infer<typeof triggerScoreSchema>;
