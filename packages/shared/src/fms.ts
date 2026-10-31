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

/** Why a single workflow-step cell could not be used as-is. The raw value is always returned alongside. */
export type FmsFulfilmentFieldIssue =
  /** The cell is empty. */
  | "missing"
  /** The cell holds a spreadsheet error such as "#NUM!" or "#REF!". */
  | "sheet_error"
  /** Planned/Actual is not in the sheet's usual "YYYY-MM-DD HH:MM:SS" form, so it is shown but never compared. */
  | "unrecognised_format";

export interface FmsFulfilmentStepDTO {
  step: number;
  code: string;
  name: string;
  /** Raw cell values exactly as the sheet returned them (stringified). */
  planned: string;
  actual: string;
  status: string;
  /** Null when the sheet has no column headed exactly "Time Delay" for this step. */
  timeDelay: string | null;
  issues: { field: "planned" | "actual" | "status" | "timeDelay"; issue: FmsFulfilmentFieldIssue }[];
  /**
   * A plain timestamp comparison, only when both Planned and Actual are in
   * the standard format — NOT a lateness verdict. Null when not comparable.
   */
  actualAfterPlanned: boolean | null;
}

export type FmsFulfilmentSalesRecordMatch =
  | { status: "matched"; salesRecordId: string; accountId: string | null; matchedBy: "bill_no" | "bill_no_and_timestamp" }
  | { status: "unmatched" }
  /** More than one synced order has this Bill No. and the timestamp did not single one out — deliberately not joined. */
  | { status: "ambiguous"; candidateCount: number };

export interface FmsFulfilmentOrderDTO {
  billNo: string;
  orderTimestamp: string;
  customerName: string;
  salesRecord: FmsFulfilmentSalesRecordMatch;
  steps: FmsFulfilmentStepDTO[];
  /** Steps whose Actual cell holds a value (any value) — not an interpretation of Status. */
  stepsWithActual: number;
}

export interface FmsFulfilmentStepSummaryDTO {
  step: number;
  code: string;
  name: string;
  withActual: number;
  withoutActual: number;
  withRecordedDelay: number;
  actualAfterPlanned: number;
  /** Orders where any of this step's cells is a sheet error or in an unrecognised format. */
  malformed: number;
}

export interface FmsFulfilmentRetrievalDTO {
  limit: number;
  rowsReturned: number;
  totalRowsReported: number;
  complete: boolean;
  reason: string;
}

/** Response shape for `GET /api/fms/fulfilment` — read-only; nothing is persisted. */
export type FmsFulfilmentResponseDTO =
  | { configured: false; message: string }
  | {
      configured: true;
      sheet: string;
      fetchedAt: string;
      dataSourceType: DataSourceType;
      retrieval: FmsFulfilmentRetrievalDTO;
      /** Zero-based index of the detected header row within the returned rows. */
      headerRowIndex: number;
      warnings: string[];
      totals: {
        orders: number;
        matched: number;
        unmatched: number;
        ambiguous: number;
        /** Rows after the header with content but no numeric Bill No. (e.g. formula-error rows). */
        nonOrderRows: number;
        /** Bill Nos. that appear on more than one sheet row. */
        duplicateBillNos: number;
      };
      stepSummary: FmsFulfilmentStepSummaryDTO[];
      page: number;
      pageSize: number;
      totalPages: number;
      /** Newest sheet rows first. */
      orders: FmsFulfilmentOrderDTO[];
    };
