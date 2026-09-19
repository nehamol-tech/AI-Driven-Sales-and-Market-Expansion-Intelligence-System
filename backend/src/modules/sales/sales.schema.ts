import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants.js";

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), { message: "Must be a valid decimal number with up to 2 decimal places" });

const isoDate = z.union([z.string(), z.date()]).transform((v) => new Date(v));

export const listSalesQuerySchema = z.object({
  dateFrom: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  dateTo: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  stateId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  salespersonId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;

export const createSalesRecordSchema = z.object({
  date: isoDate,
  productId: z.string().trim().min(1).nullable().optional(),
  customerName: z.string().trim().min(1, "Customer name is required").max(300),
  stateId: z.string().trim().min(1).nullable().optional(),
  cityId: z.string().trim().min(1).nullable().optional(),
  industryId: z.string().trim().min(1).nullable().optional(),
  quantity: z.coerce.number().int().positive(),
  orderValue: decimalString,
  salespersonId: z.string().trim().min(1).nullable().optional(),
  isNewCustomer: z.boolean().default(false),
  // Phase 8: optional attribution to a Distributor — powers
  // distributor-expansion.service.ts's totalRevenue/orderCount. Purely
  // additive; omitting it leaves the sale unattributed exactly as before.
  distributorId: z.string().trim().min(1).nullable().optional(),
});
export type CreateSalesRecordInput = z.infer<typeof createSalesRecordSchema>;

export const updateSalesRecordSchema = z.object({
  date: isoDate.optional(),
  productId: z.string().trim().min(1).nullable().optional(),
  customerName: z.string().trim().min(1).max(300).optional(),
  stateId: z.string().trim().min(1).nullable().optional(),
  cityId: z.string().trim().min(1).nullable().optional(),
  industryId: z.string().trim().min(1).nullable().optional(),
  quantity: z.coerce.number().int().positive().optional(),
  orderValue: decimalString.optional(),
  salespersonId: z.string().trim().min(1).nullable().optional(),
  isNewCustomer: z.boolean().optional(),
  distributorId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateSalesRecordInput = z.infer<typeof updateSalesRecordSchema>;

export const salesRecordIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export const importBatchIdParamSchema = z.object({
  batchId: z.string().trim().min(1),
});
