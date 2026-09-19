import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants.js";

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), { message: "Must be a valid decimal number with up to 2 decimal places" });

export const listProductsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  isActive: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(300),
  sku: z.string().trim().min(1, "SKU is required").max(100),
  category: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  price: decimalString,
  minOrderQty: z.coerce.number().int().positive().default(1),
  availableQty: z.coerce.number().int().min(0).default(0),
  keywords: z.array(z.string().trim().min(1)).default([]),
  isActive: z.boolean().default(true),
  targetIndustryIds: z.array(z.string().trim().min(1)).default([]),
  targetBusinessTypeIds: z.array(z.string().trim().min(1)).default([]),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  sku: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  price: decimalString.optional(),
  minOrderQty: z.coerce.number().int().positive().optional(),
  availableQty: z.coerce.number().int().min(0).optional(),
  keywords: z.array(z.string().trim().min(1)).optional(),
  isActive: z.boolean().optional(),
  targetIndustryIds: z.array(z.string().trim().min(1)).optional(),
  targetBusinessTypeIds: z.array(z.string().trim().min(1)).optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productIdParamSchema = z.object({
  id: z.string().trim().min(1),
});
