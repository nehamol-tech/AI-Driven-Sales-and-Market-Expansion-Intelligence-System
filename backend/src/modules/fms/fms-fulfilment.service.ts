import type { PrismaClient } from "@prisma/client";
import type {
  FmsFulfilmentFieldIssue,
  FmsFulfilmentOrderDTO,
  FmsFulfilmentResponseDTO,
  FmsFulfilmentSalesRecordMatch,
  FmsFulfilmentStepDTO,
  FmsFulfilmentStepSummaryDTO,
  FmsRawRow,
} from "@ai-sales/shared";
import type { FmsClient } from "./fms.client.js";

/**
 * Read-only Order Fulfilment view over the "FMS" sheet (Phase 5).
 *
 * The Apps Script uses the sheet's FIRST row as its JSON keys, but this
 * sheet's real headers sit lower down (after a process-definition block of
 * step codes / What / Who / How / When rows), so the raw keys are
 * meaningless ("Column_11", stringified 1899 dates, "0000001"). Nothing here
 * relies on those key names: the header row is located by its own
 * "Timestamp" and "Bill No." cells, each raw key is translated through that
 * row, and each step's columns are located from the sheet's own "stepN"
 * marker cell (which sits above that step's "Actual" column). Every
 * required column is validated before any row is processed — an
 * unrecognised layout is reported, never guessed around.
 *
 * Strictly read-only: one GET through the unmodified FmsClient and one
 * SELECT on SalesRecord. Nothing is persisted, nothing is synced.
 */

export const FULFILMENT_SHEET_NAME = "FMS";
/** The Apps Script's own maximum per request — confirmed live: larger limits still return 10,000 rows. */
export const FULFILMENT_FETCH_LIMIT = 10000;
/** The header row is searched for only near the top of the sheet. */
const HEADER_SEARCH_ROWS = 50;
/** When the row limit is hit, this many trailing rows with no orders are taken as evidence that order data ended before the cut-off. */
const TRAILING_NON_ORDER_ROWS = 500;

export const FULFILMENT_STEPS = [
  { step: 1, code: "step1", name: "Billing and Rechecking" },
  { step: 2, code: "step2", name: "Material Shuffling/Loading" },
  { step: 3, code: "step3", name: "Material Dispatch" },
  { step: 4, code: "step4", name: "Customer Received" },
  { step: 5, code: "step5", name: "Accounts Process" },
] as const;

const TIMESTAMP_HEADER = "Timestamp";
const BILL_NO_HEADER = "Bill No.";
const CUSTOMER_NAME_HEADER = "Customer Name";
export const REQUIRED_ORDER_HEADERS = [
  TIMESTAMP_HEADER,
  BILL_NO_HEADER,
  CUSTOMER_NAME_HEADER,
  "Product & Qty",
  "Bill Amount",
  "Order Taken",
  "Dispatched By",
  "Dispatched Date",
  "PDC Cheque",
] as const;
const TIME_DELAY_HEADER = "Time Delay";

const STANDARD_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const SHEET_ERROR = /^#(NUM!|REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NULL!|ERROR!)$/i;
const BILL_NO = /^\d+$/;

/** Sheet cells can arrive as JSON numbers despite FmsRawRow's string type. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

interface StepColumns {
  step: number;
  code: string;
  name: string;
  plannedKey: string;
  actualKey: string;
  statusKey: string;
  timeDelayKey: string | null;
}

export interface FulfilmentLayout {
  headerRowIndex: number;
  orderKeys: Record<(typeof REQUIRED_ORDER_HEADERS)[number], string>;
  steps: StepColumns[];
  warnings: string[];
}

export type DetectLayoutResult = { ok: true; layout: FulfilmentLayout } | { ok: false; problems: string[] };

/**
 * Locates the real header row and every required column. Column ORDER comes
 * from the header row object's key order (JSON object order, as returned);
 * each step's Planned/Actual/Status/Time Delay adjacency is then checked
 * against the real header labels, so a reordered or collapsed key set fails
 * validation instead of silently mis-mapping.
 */
export function detectFulfilmentLayout(rows: FmsRawRow[]): DetectLayoutResult {
  const searchLimit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  let headerRowIndex = -1;
  for (let i = 0; i < searchLimit; i++) {
    const values = Object.values(rows[i]).map((v) => cellText(v).trim());
    if (values.includes(TIMESTAMP_HEADER) && values.includes(BILL_NO_HEADER)) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) {
    return {
      ok: false,
      problems: [`No header row containing both "${TIMESTAMP_HEADER}" and "${BILL_NO_HEADER}" in the first ${HEADER_SEARCH_ROWS} rows.`],
    };
  }

  const headerRow = rows[headerRowIndex];
  const keys = Object.keys(headerRow);
  const headers = keys.map((k) => cellText(headerRow[k]).trim());
  const problems: string[] = [];
  const warnings: string[] = [];

  const orderKeys = {} as FulfilmentLayout["orderKeys"];
  for (const header of REQUIRED_ORDER_HEADERS) {
    const index = headers.indexOf(header);
    if (index === -1) problems.push(`Required column "${header}" not found in the header row.`);
    else orderKeys[header] = keys[index];
  }

  const rowsAbove = rows.slice(0, headerRowIndex);
  const steps: StepColumns[] = [];
  for (const def of FULFILMENT_STEPS) {
    const markerKey = findMarkerKey(rowsAbove, def.code);
    if (!markerKey) {
      problems.push(`Step marker "${def.code}" (${def.name}) not found above the header row.`);
      continue;
    }
    const pos = keys.indexOf(markerKey);
    const label = (offset: number) => headers[pos + offset] ?? "(none)";
    if (label(0) !== "Actual" || label(-1) !== "Planned" || label(1) !== "Status") {
      problems.push(
        `Step ${def.step} (${def.name}): expected columns "Planned | Actual | Status" around its marker, found "${label(-1)} | ${label(0)} | ${label(1)}".`,
      );
      continue;
    }
    let timeDelayKey: string | null = null;
    if (label(2) === TIME_DELAY_HEADER) timeDelayKey = keys[pos + 2];
    else
      warnings.push(
        `Step ${def.step} (${def.name}): the column after Status is headed "${label(2)}", not "${TIME_DELAY_HEADER}", so no recorded delay is read for this step.`,
      );
    steps.push({
      step: def.step,
      code: def.code,
      name: def.name,
      plannedKey: keys[pos - 1],
      actualKey: markerKey,
      statusKey: keys[pos + 1],
      timeDelayKey,
    });
  }

  const nameRow = rowsAbove.find((row) => cellText(Object.values(row)[0]).trim() === "What");
  if (nameRow) {
    const names = new Set(Object.values(nameRow).map((v) => cellText(v).trim()));
    for (const def of FULFILMENT_STEPS) {
      if (!names.has(def.name)) warnings.push(`Step name "${def.name}" was not found in the sheet's "What" row.`);
    }
  } else {
    warnings.push(`The sheet's "What" row (step names) was not found; step names could not be cross-checked.`);
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, layout: { headerRowIndex, orderKeys, steps, warnings } };
}

function findMarkerKey(rowsAbove: FmsRawRow[], code: string): string | null {
  for (const row of rowsAbove) {
    for (const [key, value] of Object.entries(row)) {
      if (cellText(value).trim().toLowerCase() === code) return key;
    }
  }
  return null;
}

function classify(value: string, expectTimestamp: boolean): FmsFulfilmentFieldIssue | null {
  const trimmed = value.trim();
  if (trimmed === "") return "missing";
  if (SHEET_ERROR.test(trimmed)) return "sheet_error";
  if (expectTimestamp && !STANDARD_TIMESTAMP.test(trimmed)) return "unrecognised_format";
  return null;
}

function parseStep(row: FmsRawRow, cols: StepColumns): FmsFulfilmentStepDTO {
  const planned = cellText(row[cols.plannedKey]);
  const actual = cellText(row[cols.actualKey]);
  const status = cellText(row[cols.statusKey]);
  const timeDelay = cols.timeDelayKey ? cellText(row[cols.timeDelayKey]) : null;

  const issues: FmsFulfilmentStepDTO["issues"] = [];
  const add = (field: FmsFulfilmentStepDTO["issues"][number]["field"], issue: FmsFulfilmentFieldIssue | null) => {
    if (issue) issues.push({ field, issue });
  };
  const plannedIssue = classify(planned, true);
  const actualIssue = classify(actual, true);
  add("planned", plannedIssue);
  add("actual", actualIssue);
  add("status", classify(status, false));
  if (timeDelay !== null) add("timeDelay", classify(timeDelay, false));

  // Same fixed-width format and same source timezone, so string order is time order.
  const actualAfterPlanned = plannedIssue === null && actualIssue === null ? actual.trim() > planned.trim() : null;

  return { step: cols.step, code: cols.code, name: cols.name, planned, actual, status, timeDelay, issues, actualAfterPlanned };
}

export interface ParsedFulfilmentOrder {
  billNo: string;
  orderTimestamp: string;
  customerName: string;
  steps: FmsFulfilmentStepDTO[];
}

export interface ParsedFulfilmentSheet {
  orders: ParsedFulfilmentOrder[];
  nonOrderRows: number;
  /** Index (within the returned rows) of the last order row, or -1. */
  lastOrderRowIndex: number;
}

/** Every row after the header: blank rows are ignored, rows with a numeric Bill No. are orders, anything else is counted as a non-order row. */
export function parseFulfilmentRows(rows: FmsRawRow[], layout: FulfilmentLayout): ParsedFulfilmentSheet {
  const orders: ParsedFulfilmentOrder[] = [];
  let nonOrderRows = 0;
  let lastOrderRowIndex = -1;

  for (let i = layout.headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (Object.values(row).every((v) => cellText(v).trim() === "")) continue;

    const billNo = cellText(row[layout.orderKeys[BILL_NO_HEADER]]).trim();
    if (!BILL_NO.test(billNo)) {
      nonOrderRows++;
      continue;
    }
    lastOrderRowIndex = i;
    orders.push({
      billNo,
      orderTimestamp: cellText(row[layout.orderKeys[TIMESTAMP_HEADER]]),
      customerName: cellText(row[layout.orderKeys[CUSTOMER_NAME_HEADER]]),
      steps: layout.steps.map((cols) => parseStep(row, cols)),
    });
  }
  return { orders, nonOrderRows, lastOrderRowIndex };
}

export function assessRetrieval(rowsReturned: number, totalRowsReported: number, lastOrderRowIndex: number) {
  const base = { limit: FULFILMENT_FETCH_LIMIT, rowsReturned, totalRowsReported };
  if (rowsReturned < FULFILMENT_FETCH_LIMIT) {
    return { ...base, complete: true, reason: "The Apps Script returned fewer rows than the request limit, so no rows were cut off." };
  }
  const trailing = rowsReturned - 1 - lastOrderRowIndex;
  if (lastOrderRowIndex >= 0 && trailing >= TRAILING_NON_ORDER_ROWS) {
    return {
      ...base,
      complete: true,
      reason: `The ${FULFILMENT_FETCH_LIMIT.toLocaleString("en-US")}-row limit was reached, but the last ${trailing.toLocaleString("en-US")} returned rows contain no orders, so order data ends before the cut-off.`,
    };
  }
  return {
    ...base,
    complete: false,
    reason: `The ${FULFILMENT_FETCH_LIMIT.toLocaleString("en-US")}-row limit was reached while order rows were still being returned. Later orders in the sheet may be missing from this view.`,
  };
}

export interface SyncedOrderRef {
  id: string;
  accountId: string | null;
  timestamp: string;
  /** The order's raw "Order Taken" text as synced — a name as entered in the sheet, not a mapped User. */
  orderTaken: string;
}

/**
 * Exact join only: Bill No. against SalesRecord.metadata.fms.billNo (how
 * fms-order-sync.util.ts stores it). externalRef is NOT used. When a Bill
 * No. has several synced orders, an exact timestamp match may single one
 * out; otherwise the order is reported as ambiguous and left unjoined.
 */
export function matchSalesRecord(order: ParsedFulfilmentOrder, index: Map<string, SyncedOrderRef[]>): FmsFulfilmentSalesRecordMatch {
  const resolved = resolveSyncedOrder(order.billNo, order.orderTimestamp, index);
  if (resolved.status !== "matched") return resolved;
  return { status: "matched", salesRecordId: resolved.ref.id, accountId: resolved.ref.accountId, matchedBy: resolved.matchedBy };
}

export type ResolvedSyncedOrder =
  | { status: "matched"; ref: SyncedOrderRef; matchedBy: "bill_no" | "bill_no_and_timestamp" }
  | { status: "unmatched" }
  | { status: "ambiguous"; candidateCount: number };

/** The join itself, shared by every sheet view keyed by Bill No. (Order Fulfilment, Overdue). */
export function resolveSyncedOrder(billNo: string, timestamp: string, index: Map<string, SyncedOrderRef[]>): ResolvedSyncedOrder {
  const candidates = index.get(billNo) ?? [];
  if (candidates.length === 0) return { status: "unmatched" };
  if (candidates.length === 1) return { status: "matched", ref: candidates[0], matchedBy: "bill_no" };
  const exact = candidates.filter((c) => c.timestamp === timestamp);
  if (exact.length === 1) return { status: "matched", ref: exact[0], matchedBy: "bill_no_and_timestamp" };
  return { status: "ambiguous", candidateCount: candidates.length };
}

function readStoredFms(metadata: unknown): { billNo: string; timestamp: string; orderTaken: string } | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fms = (metadata as Record<string, unknown>).fms;
  if (typeof fms !== "object" || fms === null) return null;
  const { billNo, timestamp, orderTaken } = fms as Record<string, unknown>;
  if (typeof billNo !== "string" || billNo.trim() === "") return null;
  return {
    billNo: billNo.trim(),
    timestamp: typeof timestamp === "string" ? timestamp : "",
    orderTaken: typeof orderTaken === "string" ? orderTaken : "",
  };
}

export async function buildSyncedOrderIndex(
  prisma: Pick<PrismaClient, "salesRecord">,
  companyId: string,
): Promise<Map<string, SyncedOrderRef[]>> {
  const records = await prisma.salesRecord.findMany({
    where: { companyId, source: "FMS_SYNC" },
    select: { id: true, accountId: true, metadata: true },
  });
  const index = new Map<string, SyncedOrderRef[]>();
  for (const record of records) {
    const stored = readStoredFms(record.metadata);
    if (!stored) continue;
    const list = index.get(stored.billNo) ?? [];
    list.push({ id: record.id, accountId: record.accountId, timestamp: stored.timestamp, orderTaken: stored.orderTaken });
    index.set(stored.billNo, list);
  }
  return index;
}

function summariseSteps(orders: ParsedFulfilmentOrder[]): FmsFulfilmentStepSummaryDTO[] {
  return FULFILMENT_STEPS.map((def) => {
    const summary: FmsFulfilmentStepSummaryDTO = {
      ...def,
      withActual: 0,
      withoutActual: 0,
      withRecordedDelay: 0,
      actualAfterPlanned: 0,
      malformed: 0,
    };
    for (const order of orders) {
      const step = order.steps.find((s) => s.step === def.step);
      if (!step) continue;
      if (step.actual.trim() === "") summary.withoutActual++;
      else summary.withActual++;
      if (step.timeDelay !== null && step.timeDelay.trim() !== "") summary.withRecordedDelay++;
      if (step.actualAfterPlanned) summary.actualAfterPlanned++;
      if (step.issues.some((i) => i.issue !== "missing")) summary.malformed++;
    }
    return summary;
  });
}

type SheetFetch =
  | { status: "ok"; rows: FmsRawRow[]; totalRows: number; sheet: string; fetchedAt: string; parsed: ParsedSheet }
  | { status: "upstream_error"; message: string };

type ParsedSheet = { ok: true; layout: FulfilmentLayout; parsed: ParsedFulfilmentSheet } | { ok: false; problems: string[] };

/**
 * Layout detection + row parsing memoised per cached Apps Script response
 * (CachedFmsClient returns the same result object until it refreshes), so
 * paging through orders doesn't re-parse the 10,000-row sheet each time.
 */
const parsedByResponse = new WeakMap<object, ParsedSheet>();

function parseSheet(rows: FmsRawRow[]): ParsedSheet {
  const detected = detectFulfilmentLayout(rows);
  if (!detected.ok) return { ok: false, problems: detected.problems };
  return { ok: true, layout: detected.layout, parsed: parseFulfilmentRows(rows, detected.layout) };
}

async function fetchSheet(client: FmsClient): Promise<SheetFetch> {
  const result = await client.fetchData({ sheet: FULFILMENT_SHEET_NAME, limit: FULFILMENT_FETCH_LIMIT });
  if (result.status === "network_error" || result.status === "malformed_response") {
    return { status: "upstream_error", message: result.message };
  }
  if (result.status === "upstream_rejected") {
    return { status: "upstream_error", message: `The FMS API rejected the "${FULFILMENT_SHEET_NAME}" sheet request: ${result.error}` };
  }
  let parsed = parsedByResponse.get(result.body);
  if (!parsed) {
    parsed = parseSheet(result.body.data);
    parsedByResponse.set(result.body, parsed);
  }
  return {
    status: "ok",
    rows: result.body.data,
    totalRows: result.body.totalRows,
    sheet: result.body.sheet,
    fetchedAt: result.fetchedAt ?? new Date().toISOString(),
    parsed,
  };
}

export type GetOrderFulfilmentResult =
  | { status: "ok"; dto: Extract<FmsFulfilmentResponseDTO, { configured: true }> }
  | { status: "upstream_error"; message: string }
  | { status: "layout_invalid"; problems: string[] };

export async function getOrderFulfilment(
  prisma: Pick<PrismaClient, "salesRecord">,
  client: FmsClient,
  companyId: string,
  params: { page: number; pageSize: number },
): Promise<GetOrderFulfilmentResult> {
  const sheet = await fetchSheet(client);
  if (sheet.status === "upstream_error") return sheet;
  if (!sheet.parsed.ok) return { status: "layout_invalid", problems: sheet.parsed.problems };
  const { layout, parsed } = sheet.parsed;

  const index = await buildSyncedOrderIndex(prisma, companyId);

  const billCounts = new Map<string, number>();
  for (const order of parsed.orders) billCounts.set(order.billNo, (billCounts.get(order.billNo) ?? 0) + 1);

  const allOrders: FmsFulfilmentOrderDTO[] = parsed.orders
    .map((order) => ({
      ...order,
      salesRecord: matchSalesRecord(order, index),
      stepsWithActual: order.steps.filter((s) => s.actual.trim() !== "").length,
    }))
    .reverse();

  const totalPages = Math.max(1, Math.ceil(allOrders.length / params.pageSize));
  const page = Math.min(params.page, totalPages);
  const start = (page - 1) * params.pageSize;

  return {
    status: "ok",
    dto: {
      configured: true,
      sheet: sheet.sheet,
      fetchedAt: sheet.fetchedAt,
      dataSourceType: "EXTERNAL_DATA",
      retrieval: assessRetrieval(sheet.rows.length, sheet.totalRows, parsed.lastOrderRowIndex),
      headerRowIndex: layout.headerRowIndex,
      warnings: layout.warnings,
      totals: {
        orders: allOrders.length,
        matched: allOrders.filter((o) => o.salesRecord.status === "matched").length,
        unmatched: allOrders.filter((o) => o.salesRecord.status === "unmatched").length,
        ambiguous: allOrders.filter((o) => o.salesRecord.status === "ambiguous").length,
        nonOrderRows: parsed.nonOrderRows,
        duplicateBillNos: [...billCounts.values()].filter((n) => n > 1).length,
      },
      stepSummary: summariseSteps(parsed.orders),
      page,
      pageSize: params.pageSize,
      totalPages,
      orders: allOrders.slice(start, start + params.pageSize),
    },
  };
}
