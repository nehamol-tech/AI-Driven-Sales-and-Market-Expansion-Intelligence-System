import { env } from "../../config/env.js";
import { FmsApiClient, type FetchFmsDataParams, type FmsClient } from "./fms.client.js";
import { CachedFmsClient } from "./fms-cache.js";
import { FmsPagedApiClient } from "./fms-paged.client.js";
import { FULFILMENT_FETCH_LIMIT, FULFILMENT_SHEET_NAME } from "./fms-fulfilment.service.js";
import {
  CUSTOMER_CODE_FETCH_LIMIT,
  CUSTOMER_CODE_SHEET_NAME,
  OVERDUE_FETCH_LIMIT,
  OVERDUE_SHEET_NAME,
} from "../opportunities/overdue.service.js";

/**
 * Sheets only the original Web App (FMS_API_URL) serves — the paginated one
 * rejects them ("Sheet is not allowed"). Empty: the configured paginated Web
 * App now serves "FMS Response" (read by fms-order-history-sync.service.ts,
 * POST /api/fms/sync-history) from the original spreadsheet.
 */
export const LEGACY_ONLY_SHEETS: ReadonlySet<string> = new Set<string>();

/** Whether this backend deployment has an FMS Web App URL configured at all. */
export function isFmsConfigured(): boolean {
  return Boolean(env.FMS_API_URL || env.FMS_PAGED_API_URL);
}

/**
 * Picks the Web App for each request: the paginated one (FMS_PAGED_API_URL,
 * fms-paged.client.ts) when configured, except for LEGACY_ONLY_SHEETS, which
 * stay on the original (FMS_API_URL). With FMS_PAGED_API_URL unset this is
 * exactly the original client — the fallback is to unset it.
 */
function buildFmsClient(): FmsClient | null {
  const legacy = env.FMS_API_URL ? new FmsApiClient(env.FMS_API_URL) : null;
  if (!env.FMS_PAGED_API_URL) return legacy;
  const paged = new FmsPagedApiClient(env.FMS_PAGED_API_URL);
  if (!legacy) return paged;
  return {
    fetchData: (params) => (params.sheet && LEGACY_ONLY_SHEETS.has(params.sheet) ? legacy : paged).fetchData(params),
  };
}

/**
 * Returns null when no FMS URL is set — callers (fms.controller.ts) must
 * treat that as an honest "not configured" outcome, mirroring
 * advertising/ad-platform-clients/platform-client.factory.ts's
 * getPlatformClient exactly (never fabricate FMS data for an unconfigured
 * deployment).
 *
 * Always a direct, uncached client — the sync endpoints use this so a sync
 * reads the sheet as it is right now, never a cached copy.
 */
export function getFmsClient(): FmsClient | null {
  return buildFmsClient();
}

let cachedClient: CachedFmsClient | null = null;

/**
 * Shared, process-wide cached client for the read-only dashboard endpoints
 * (GET /api/fms/data, GET /api/fms/fulfilment) — see fms-cache.ts. Same
 * null-when-unconfigured contract as getFmsClient.
 */
export function getCachedFmsClient(): CachedFmsClient | null {
  if (cachedClient) return cachedClient;
  const client = buildFmsClient();
  if (!client) return null;
  cachedClient = new CachedFmsClient(client);
  return cachedClient;
}

/**
 * The exact sheet requests the frontend makes (dashboard cards, /fms page,
 * fulfilment view), pre-loaded at server start so the first visitor doesn't
 * wait on the Apps Script. Must match the frontend's sheet/limit params to
 * hit the same cache entries.
 */
export const FMS_WARM_REQUESTS: FetchFmsDataParams[] = [
  { sheet: "Form responses 2", limit: 10 },
  { sheet: "Data", limit: 20 },
  { sheet: "FMS", limit: 10 },
  { sheet: FULFILMENT_SHEET_NAME, limit: FULFILMENT_FETCH_LIMIT },
  // Opportunity Center → Overdue (opportunities/overdue.service.ts).
  { sheet: OVERDUE_SHEET_NAME, limit: OVERDUE_FETCH_LIMIT },
  { sheet: CUSTOMER_CODE_SHEET_NAME, limit: CUSTOMER_CODE_FETCH_LIMIT },
];
