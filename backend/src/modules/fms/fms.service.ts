import type { FmsDataResponseDTO } from "@ai-sales/shared";
import type { FetchFmsDataParams, FmsClient } from "./fms.client.js";

export type GetFmsDataResult =
  | { status: "ok"; dto: FmsDataResponseDTO & { configured: true } }
  | { status: "bad_request"; error: string; allowedSheets: string[] | null }
  | { status: "upstream_error"; message: string };

/**
 * Orchestrates a single read-only fetch from the FMS Apps Script API and
 * shapes it into the app's response DTO. Takes an injected `FmsClient`
 * (rather than constructing one itself) so this is unit-testable with a fake
 * client — mirrors ad-sync.service.ts's syncCampaignsFromPlatform taking an
 * AdPlatformClient parameter. Never persists to the database and never
 * renames/reinterprets a row's keys — `data` is passed through exactly as
 * the client parsed it.
 */
export async function getFmsData(client: FmsClient, params: FetchFmsDataParams): Promise<GetFmsDataResult> {
  const result = await client.fetchData(params);

  if (result.status === "network_error" || result.status === "malformed_response") {
    return { status: "upstream_error", message: result.message };
  }
  if (result.status === "upstream_rejected") {
    return { status: "bad_request", error: result.error, allowedSheets: result.allowedSheets };
  }

  return {
    status: "ok",
    dto: {
      configured: true,
      sheet: result.body.sheet,
      count: result.body.count,
      totalRows: result.body.totalRows,
      data: result.body.data,
      fetchedAt: new Date().toISOString(),
      dataSourceType: "EXTERNAL_DATA",
    },
  };
}
