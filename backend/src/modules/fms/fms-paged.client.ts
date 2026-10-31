import type { FmsRawRow } from "@ai-sales/shared";
import type { FetchFmsDataParams, FetchFmsDataResult, FmsClient } from "./fms.client.js";

/**
 * Client for the paginated read-only Apps Script Web App
 * (`?sheet=&limit=&offset=` → `{ headers[], rows[][], hasMore, nextOffset, … }`).
 *
 * It returns exactly the shape the original Web App returned (see
 * fms.client.ts — `{ sheet, count, totalRows, data: object[] }`), so every
 * existing consumer, the cache and the frontend work unchanged. The rules
 * below were confirmed by comparing both deployments' live responses for the
 * same rows:
 * - row objects are keyed by header, built in column order with plain
 *   assignment — so a duplicated header keeps its first position and the
 *   last column's value (as the original did);
 * - headers are trimmed; a blank header becomes `Column_<1-based index>`;
 * - a date header (the sheet's time-of-day cells, dated 1899-12-30) becomes
 *   JavaScript's Date#toString() form in the sheet's time zone, e.g.
 *   "Sat Dec 30 1899 09:30:00 GMT+0521 (India Standard Time)";
 * - a date cell (ISO UTC from the new API) becomes "yyyy-MM-dd HH:mm:ss" in
 *   the sheet's time zone — the form existing SalesRecords were stored with;
 * - every other value (numbers, empty strings, multiline text) is passed
 *   through untouched;
 * - rows whose cells are all empty are skipped, and `limit` counts only the
 *   rows returned (default 1000, at most 10,000).
 *
 * Read-only: only ever issues GET requests with no body.
 */

/** The spreadsheet's time zone — every date the original Web App returned was formatted in it. */
export const FMS_SHEET_TIME_ZONE = "Asia/Kolkata";
/** The original Web App's default and maximum `limit`, preserved so callers see the same rows. */
export const FMS_DEFAULT_LIMIT = 1000;
export const FMS_MAX_LIMIT = 10_000;
/** The new Web App returns at most 1000 rows per request. */
export const FMS_PAGE_SIZE = 1000;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function part(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes): string {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", ...options });
    formatters.set(key, formatter);
  }
  return formatter.formatToParts(date).find((p) => p.type === type)?.value ?? "";
}

/** Wall-clock "yyyy-MM-dd HH:mm:ss" of `date` in `timeZone` (historical offsets included, e.g. +05:21:10 for 1899 India). */
function wallClock(date: Date, timeZone: string): string {
  const key = `${timeZone}|numeric`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(key, formatter);
  }
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of formatter.formatToParts(date)) p[type] = value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** "2026-04-02T04:30:00.000Z" → "2026-04-02 10:00:00" (sheet time zone). */
export function formatSheetDate(iso: string, timeZone = FMS_SHEET_TIME_ZONE): string {
  return wallClock(new Date(iso), timeZone);
}

/** "1899-12-30T04:08:50.000Z" → "Sat Dec 30 1899 09:30:00 GMT+0521 (India Standard Time)". */
export function formatSheetDateHeader(iso: string, timeZone = FMS_SHEET_TIME_ZONE): string {
  const date = new Date(iso);
  const time = wallClock(date, timeZone).slice(11);
  // "GMT+05:21:10" → "GMT+0521" (Date#toString drops the seconds); "GMT" alone means +0000.
  const m = /^GMT([+-])(\d{2}):(\d{2})/.exec(part(date, timeZone, { timeZoneName: "longOffset" }, "timeZoneName"));
  const offset = m ? `GMT${m[1]}${m[2]}${m[3]}` : "GMT+0000";
  // Date#toString names the zone as it is today ("India Standard Time"), even for historical offsets ICU has no name for.
  const zoneName = part(new Date(), timeZone, { timeZoneName: "long" }, "timeZoneName");
  const weekday = part(date, timeZone, { weekday: "short" }, "weekday");
  const month = part(date, timeZone, { month: "short" }, "month");
  const day = part(date, timeZone, { day: "2-digit" }, "day");
  const year = part(date, timeZone, { year: "numeric" }, "year");
  return `${weekday} ${month} ${day} ${year} ${time} ${offset} (${zoneName})`;
}

/** The original Web App's key for a header cell. */
export function legacyHeaderKey(header: unknown, index: number): string {
  if (typeof header === "string" && ISO_UTC.test(header)) return formatSheetDateHeader(header);
  const text = header == null ? "" : String(header).trim();
  return text === "" ? `Column_${index + 1}` : text;
}

/** The original Web App's representation of a cell value. */
export function legacyCellValue(value: unknown): unknown {
  if (typeof value === "string" && ISO_UTC.test(value)) return formatSheetDate(value);
  return value;
}

/** Builds row objects exactly as the original Web App did; all-empty rows are dropped. */
export function toLegacyRows(headers: unknown[], rows: unknown[][]): FmsRawRow[] {
  const keys = headers.map(legacyHeaderKey);
  const out: FmsRawRow[] = [];
  for (const row of rows) {
    if (row.every((cell) => cell === "" || cell == null)) continue;
    const obj: Record<string, unknown> = {};
    keys.forEach((key, i) => {
      obj[key] = legacyCellValue(row[i] ?? "");
    });
    out.push(obj as FmsRawRow);
  }
  return out;
}

interface PagedPage {
  sheet: string;
  headers: unknown[];
  rows: unknown[][];
  totalRows: number;
  hasMore: boolean;
  nextOffset: number | null;
}

type PageResult = { status: "ok"; page: PagedPage } | Exclude<FetchFmsDataResult, { status: "ok" }>;

/** Pure validation of one page of the paginated Web App's JSON body. */
export function parsePagedResponse(json: unknown): PageResult {
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
  if (body.success !== true) return { status: "malformed_response", message: "FMS API response is missing a boolean 'success' field" };
  if (typeof body.sheet !== "string") return { status: "malformed_response", message: "FMS API response is missing a string 'sheet' field" };
  if (!Array.isArray(body.headers)) return { status: "malformed_response", message: "FMS API response is missing a 'headers' array" };
  if (!Array.isArray(body.rows) || !body.rows.every(Array.isArray)) {
    return { status: "malformed_response", message: "FMS API response is missing a 'rows' array of arrays" };
  }
  if (typeof body.totalRows !== "number" || typeof body.hasMore !== "boolean") {
    return { status: "malformed_response", message: "FMS API response is missing numeric 'totalRows' / boolean 'hasMore' fields" };
  }
  if (body.hasMore && typeof body.nextOffset !== "number") {
    return { status: "malformed_response", message: "FMS API response has 'hasMore' but no numeric 'nextOffset'" };
  }
  return {
    status: "ok",
    page: {
      sheet: body.sheet,
      headers: body.headers,
      rows: body.rows as unknown[][],
      totalRows: body.totalRows,
      hasMore: body.hasMore,
      nextOffset: typeof body.nextOffset === "number" ? body.nextOffset : null,
    },
  };
}

export class FmsPagedApiClient implements FmsClient {
  constructor(
    private readonly apiUrl: string,
    private readonly pageSize = FMS_PAGE_SIZE,
  ) {}

  private async fetchPage(sheet: string | undefined, limit: number, offset: number): Promise<PageResult> {
    const url = new URL(this.apiUrl);
    if (sheet) url.searchParams.set("sheet", sheet);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    let res: Response;
    try {
      res = await fetch(url.toString(), { method: "GET" });
    } catch (err) {
      return { status: "network_error", message: err instanceof Error ? err.message : "Unknown network error contacting the FMS API" };
    }
    if (!res.ok) return { status: "network_error", message: `FMS API responded with HTTP ${res.status}` };

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { status: "malformed_response", message: "FMS API response was not valid JSON" };
    }
    return parsePagedResponse(json);
  }

  async fetchData(params: FetchFmsDataParams): Promise<FetchFmsDataResult> {
    const limit = Math.min(params.limit ?? FMS_DEFAULT_LIMIT, FMS_MAX_LIMIT);
    const data: FmsRawRow[] = [];
    let first: PagedPage | null = null;
    let offset = 0;

    while (data.length < limit) {
      const result = await this.fetchPage(params.sheet, Math.min(this.pageSize, limit - data.length), offset);
      if (result.status !== "ok") return result;
      const page = result.page;
      if (first && JSON.stringify(page.headers) !== JSON.stringify(first.headers)) {
        return { status: "malformed_response", message: "FMS sheet headers changed between pages; try again" };
      }
      first ??= page;
      data.push(...toLegacyRows(first.headers, page.rows));
      if (!page.hasMore || page.nextOffset === null) break;
      if (page.nextOffset <= offset || page.rows.length === 0) {
        return { status: "malformed_response", message: "FMS API returned a non-advancing 'nextOffset'" };
      }
      offset = page.nextOffset;
    }

    if (!first) return { status: "malformed_response", message: "FMS API returned no pages" };
    const rows = data.slice(0, limit);
    return { status: "ok", body: { success: true, sheet: first.sheet, count: rows.length, totalRows: first.totalRows, data: rows } };
  }
}
