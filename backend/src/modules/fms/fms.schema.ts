import { z } from "zod";

/**
 * `sheet` is intentionally NOT restricted to an enum here — the Apps Script
 * itself owns and enforces the allowed-sheet list (confirmed live: it
 * returns `{success:false, error:"Sheet not allowed", allowedSheets:[...]}`
 * for an unrecognized name) and that list can change server-side without a
 * backend redeploy. `limit` is bounded to keep a single request reasonable;
 * the Apps Script has its own default when omitted.
 */
export const fmsDataQuerySchema = z.object({
  sheet: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

export type FmsDataQuery = z.infer<typeof fmsDataQuerySchema>;

/** Paging for GET /api/fms/fulfilment. The whole sheet is always read and summarised; only the returned order list is paged. */
export const fmsFulfilmentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

export type FmsFulfilmentQuery = z.infer<typeof fmsFulfilmentQuerySchema>;
