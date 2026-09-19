import { z } from "zod";

/**
 * GET /api/dashboard/sales-trend query params. Every filter is optional —
 * an empty query means "the whole company, unfiltered" (mirrors
 * sales-trend.service.ts's own buildWhere, which only adds a clause per
 * provided filter). `dateFrom`/`dateTo` coerce to real Date objects;
 * `stateId`/`productId`/`distributorId` are plain non-empty id strings —
 * never validated against a real row here (an id that matches nothing simply
 * yields zero real SalesRecords, exactly like every other id-filtered query
 * in this codebase).
 */
export const salesTrendQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  stateId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  distributorId: z.string().trim().min(1).optional(),
});
export type SalesTrendQuery = z.infer<typeof salesTrendQuerySchema>;
