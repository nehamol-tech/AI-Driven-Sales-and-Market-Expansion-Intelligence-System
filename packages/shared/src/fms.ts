import type { DataSourceType } from "./data-source.js";

/**
 * One raw row from the FMS Google Sheet, as returned by the read-only Google
 * Apps Script Web App proxy. The underlying sheet has multiple header/
 * instruction rows, so the API's own JSON keys are NOT reliable business
 * column names — real examples seen from the live endpoint include a bare
 * row number ("19"), a stringified JS Date, a decimal day-fraction
 * ("0.41666666666666663"), generic placeholders ("Column_11"), and workflow
 * labels ("step1"). Every value is therefore treated as an opaque string
 * keyed by whatever the sheet's header cell happened to contain — do NOT
 * assume any particular key exists, and do NOT rename/reinterpret a key
 * without a dedicated, explicitly-approved normalization layer that traces
 * each mapped field back to its real source column.
 */
export type FmsRawRow = Record<string, string>;

/**
 * Response shape for `GET /api/fms/data`. `configured: false` means this
 * backend deployment has no `FMS_API_URL` set — the frontend must treat that
 * as "integration not set up here", never as "zero rows" (mirrors
 * AdConnectionDTO's `configured` field exactly). `dataSourceType` is always
 * `"EXTERNAL_DATA"` on a successful fetch, preserving this app's existing
 * data-provenance convention for anything not entered directly by a user.
 */
export type FmsDataResponseDTO =
  | { configured: false; message: string }
  | {
      configured: true;
      sheet: string;
      count: number;
      totalRows: number;
      data: FmsRawRow[];
      fetchedAt: string;
      dataSourceType: DataSourceType;
    };
