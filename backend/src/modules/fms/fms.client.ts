import type { FmsRawRow } from "@ai-sales/shared";

/**
 * Raw success body from the FMS Apps Script Web App, before any
 * normalization. `data` rows are opaque string-keyed records — see
 * packages/shared/src/fms.ts's FmsRawRow doc comment for why.
 */
export interface FmsApiSuccessBody {
  success: true;
  sheet: string;
  count: number;
  totalRows: number;
  data: FmsRawRow[];
}

export type ParsedFmsResponse =
  /** `fetchedAt` is set by CachedFmsClient (fms-cache.ts): when the Apps Script actually answered. Absent on a direct, uncached fetch. */
  | { status: "ok"; body: FmsApiSuccessBody; fetchedAt?: string }
  /** The Apps Script itself rejected the request (e.g. an unknown `sheet` name) — it responds HTTP 200 with `success: false` rather than a 4xx, confirmed against the live endpoint. */
  | { status: "upstream_rejected"; error: string; allowedSheets: string[] | null }
  /** Valid JSON, but not shaped like the Apps Script's documented response — never thrown, always returned, so a caller can surface a clear message instead of an uncaught exception. */
  | { status: "malformed_response"; message: string };

/**
 * Pure validation of the Apps Script's parsed JSON body — no I/O, unit
 * testable against hand-written fixtures (mirrors
 * advertising/ad-platform-clients/google-ads.client.ts's
 * parseGoogleAdsSearchStreamResponse). Never assumes a specific row shape
 * beyond "each row is a plain object" — the FMS sheet's real column headers
 * are unreliable, so no individual key is ever required, renamed, or
 * dropped here.
 */
export function parseFmsApiResponse(json: unknown): ParsedFmsResponse {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { status: "malformed_response", message: "FMS API response was not a JSON object" };
  }
  const body = json as Record<string, unknown>;

  if (body.success === false) {
    return {
      status: "upstream_rejected",
      error: typeof body.error === "string" ? body.error : "Unknown upstream error",
      allowedSheets: Array.isArray(body.allowedSheets) ? (body.allowedSheets as string[]) : null,
    };
  }
  if (body.success !== true) {
    return { status: "malformed_response", message: "FMS API response is missing a boolean 'success' field" };
  }
  if (typeof body.sheet !== "string") {
    return { status: "malformed_response", message: "FMS API response is missing a string 'sheet' field" };
  }
  if (typeof body.count !== "number" || typeof body.totalRows !== "number") {
    return { status: "malformed_response", message: "FMS API response is missing numeric 'count'/'totalRows' fields" };
  }
  if (!Array.isArray(body.data)) {
    return { status: "malformed_response", message: "FMS API response is missing a 'data' array" };
  }
  for (const row of body.data) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return { status: "malformed_response", message: "One or more rows in the FMS API's 'data' array were not plain objects" };
    }
  }

  return {
    status: "ok",
    body: { success: true, sheet: body.sheet, count: body.count, totalRows: body.totalRows, data: body.data as FmsRawRow[] },
  };
}

export interface FetchFmsDataParams {
  sheet?: string;
  limit?: number;
}

export type FetchFmsDataResult = ParsedFmsResponse | { status: "network_error"; message: string };

/**
 * Narrow contract for the FMS client so fms.service.ts can be unit-tested
 * against a fake implementation, exactly like AdPlatformClient lets
 * ad-sync.service.ts be tested without a live network call.
 */
export interface FmsClient {
  fetchData(params: FetchFmsDataParams): Promise<FetchFmsDataResult>;
}

/**
 * The only place in this module that performs network I/O. Always issues a
 * single GET request with no body to the configured read-only Apps Script
 * Web App URL — there is no code path here that can send a POST/PUT/PATCH/
 * DELETE, so this client cannot write to the underlying Google Sheet.
 * `fetch` follows the Apps Script's one-time 302 redirect to
 * script.googleusercontent.com automatically (confirmed against the live
 * endpoint; this is standard `fetch`/Node behavior, no special-casing
 * needed).
 */
export class FmsApiClient implements FmsClient {
  constructor(private readonly apiUrl: string) {}

  async fetchData(params: FetchFmsDataParams): Promise<FetchFmsDataResult> {
    const url = new URL(this.apiUrl);
    if (params.sheet) url.searchParams.set("sheet", params.sheet);
    if (params.limit != null) url.searchParams.set("limit", String(params.limit));

    let res: Response;
    try {
      res = await fetch(url.toString(), { method: "GET" });
    } catch (err) {
      return { status: "network_error", message: err instanceof Error ? err.message : "Unknown network error contacting the FMS API" };
    }

    if (!res.ok) {
      return { status: "network_error", message: `FMS API responded with HTTP ${res.status}` };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { status: "malformed_response", message: "FMS API response was not valid JSON" };
    }

    return parseFmsApiResponse(json);
  }
}
