import type { FmsRawRow } from "@ai-sales/shared";

/**
 * The original FMS row's fields that have no dedicated SalesRecord column —
 * preserved verbatim in SalesRecord.metadata (as `{ fms: FmsOrderMetadata }`),
 * never interpreted. In particular `productAndQty` is the COMPLETE raw
 * string exactly as received — never split, parsed, or reduced.
 */
export interface FmsOrderMetadata {
  billNo: string;
  timestamp: string;
  customerName: string;
  productAndQty: string;
  orderTaken: string;
  dispatchedBy: string;
  dispatchedDate: string;
  pdcChequeDate: string;
  /** The bill's own "Bill Amount", as written — never changed by adjustments. */
  billAmount: string;
  /** Negative adjustment/reversal rows applied to this bill (see fms-order-history-sync.service.ts). */
  adjustments?: FmsBillAdjustment[];
  /** billAmount + adjustments — what SalesRecord.orderValue holds when adjustments exist. */
  netAmount?: string;
}

export interface FmsBillAdjustment {
  timestamp: string;
  amount: string;
}

export interface NormalizedFmsOrder {
  customerName: string;
  /** Decimal-string form of the whole bill's "Bill Amount" — the WHOLE order's value, never split across product lines. */
  orderValue: string;
  date: Date;
  /**
   * Deterministic identity for this source order: "<Bill No.>|<टाइमस्टैम्प>",
   * built ONLY from those two fields — independent of customer/account
   * resolution, Bill Amount, and Dispatched Date, per the approved design.
   * Stored in SalesRecord.externalRef, enforced unique per (companyId,
   * source) at the database level (see schema.prisma).
   */
  externalRef: string;
  metadata: { fms: FmsOrderMetadata };
}

export type NormalizeFmsOrderResult =
  | { success: true; data: NormalizedFmsOrder }
  | { success: false; message: string };

const BILL_NO_KEY = "Bill No.";
const TIMESTAMP_KEY = "टाइमस्टैम्प";
const CUSTOMER_NAME_KEY = "Customer Name";
const ORDER_TAKEN_KEY = "Order Taken";
const DISPATCHED_BY_KEY = "Dispatched By";
const DISPATCHED_DATE_KEY = "Dispatched Date";
const BILL_AMOUNT_KEY = "Bill Amount";

/**
 * "Product and Qty"/"PDC Cheque Date" are the "Form responses 2" sheet's own
 * header spellings; "FMS Response" (Phase 3B/3C investigation) uses
 * "Product & Qty"/"PDC Cheque" for the identical field — confirmed via a
 * row-by-row schema comparison, not guessed. Checked in this order, first
 * match wins; this is column-name recognition only, never a reinterpretation
 * of the cell's content.
 */
const PRODUCT_AND_QTY_KEYS = ["Product and Qty", "Product & Qty"];
const PDC_CHEQUE_DATE_KEYS = ["PDC Cheque Date", "PDC Cheque"];

/** FMS row values are typed as strings (FmsRawRow), but real responses have returned JSON numbers for some cells (e.g. "Bill Amount", "Bill No.") — coerce defensively without assuming either shape. */
function cellToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : String(value);
}

/** Returns the value of the first of `keys` that is actually present on `row` (even if empty-string), or "" if none are. */
function readFirstPresentKey(row: FmsRawRow, keys: string[]): string {
  for (const key of keys) {
    if (key in row) return cellToString(row[key]);
  }
  return "";
}

/**
 * Pure validation/extraction of one raw "Form responses 2" row — no I/O,
 * unit-testable against fixtures (mirrors sales/sales-import.util.ts's
 * normalizeSalesCsvRow: same "Number()+isFinite+non-negative" convention for
 * the money field, same "new Date()+isNaN" convention for the date field).
 *
 * Required (fail the row if missing/invalid): Customer Name, Bill Amount,
 * Dispatched Date (all persisted to a real SalesRecord column), plus Bill
 * No. and टाइमस्टैम्प (needed to build a stable externalRef — without both,
 * no deterministic identity can be formed, so the row cannot be safely
 * synced at all).
 *
 * Preserved as-is, no validation, never interpreted: Product and Qty, Order
 * Taken, Dispatched By, PDC Cheque Date — these go into `metadata` exactly
 * as received, even if empty.
 */
export function normalizeFmsOrderRow(row: FmsRawRow): NormalizeFmsOrderResult {
  const fail = (message: string): NormalizeFmsOrderResult => ({ success: false, message });

  const billNo = cellToString(row[BILL_NO_KEY]).trim();
  if (!billNo) {
    return fail(`Missing required field: "${BILL_NO_KEY}" (needed to build a stable source identity)`);
  }

  const timestamp = cellToString(row[TIMESTAMP_KEY]).trim();
  if (!timestamp) {
    return fail(`Missing required field: "${TIMESTAMP_KEY}" (needed to build a stable source identity)`);
  }

  const customerName = cellToString(row[CUSTOMER_NAME_KEY]).trim();
  if (!customerName) {
    return fail(`Missing required field: "${CUSTOMER_NAME_KEY}"`);
  }

  const billAmountRaw = row[BILL_AMOUNT_KEY];
  const billAmountStr = cellToString(billAmountRaw).trim();
  if (!billAmountStr) {
    return fail(`Missing required field: "${BILL_AMOUNT_KEY}"`);
  }
  const billAmountNum = Number(billAmountStr);
  if (!Number.isFinite(billAmountNum) || billAmountNum < 0) {
    return fail(`Invalid "${BILL_AMOUNT_KEY}": ${JSON.stringify(billAmountRaw)} (must be a non-negative number)`);
  }
  const orderValue = billAmountNum.toFixed(2);

  const dispatchedDateRaw = cellToString(row[DISPATCHED_DATE_KEY]).trim();
  if (!dispatchedDateRaw) {
    return fail(`Missing required field: "${DISPATCHED_DATE_KEY}"`);
  }
  const date = new Date(dispatchedDateRaw);
  if (Number.isNaN(date.getTime())) {
    return fail(`Invalid "${DISPATCHED_DATE_KEY}": ${JSON.stringify(dispatchedDateRaw)}`);
  }

  const externalRef = `${billNo}|${timestamp}`;

  const metadata: { fms: FmsOrderMetadata } = {
    fms: {
      billNo,
      timestamp,
      customerName,
      productAndQty: readFirstPresentKey(row, PRODUCT_AND_QTY_KEYS),
      orderTaken: cellToString(row[ORDER_TAKEN_KEY]),
      dispatchedBy: cellToString(row[DISPATCHED_BY_KEY]),
      dispatchedDate: dispatchedDateRaw,
      pdcChequeDate: readFirstPresentKey(row, PDC_CHEQUE_DATE_KEYS),
      billAmount: billAmountStr,
    },
  };

  return { success: true, data: { customerName, orderValue, date, externalRef, metadata } };
}

/**
 * "<Bill No.>|<टाइमस्टैम्प>" for any row that has both, valid or not — the
 * identity normalizeFmsOrderRow gives it — so a sync can tell which imported
 * records a row still corresponds to. Null when either part is missing.
 */
export function fmsRowExternalRef(row: FmsRawRow): string | null {
  const billNo = cellToString(row[BILL_NO_KEY]).trim();
  const timestamp = cellToString(row[TIMESTAMP_KEY]).trim();
  return billNo && timestamp ? `${billNo}|${timestamp}` : null;
}

/**
 * Text form for comparing metadata values. Objects use sorted keys, because
 * Postgres JSONB doesn't keep key order — {"timestamp","amount"} comes back
 * as {"amount","timestamp"} and must still count as unchanged.
 */
function comparable(value: unknown): string {
  if (value === null || typeof value !== "object") return cellToString(value);
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)]))
        : v;
  return JSON.stringify(sort(value));
}

/** The stored fields a sheet row can change on an already-imported SalesRecord. */
export interface FmsRecordFields {
  customerName: string;
  /** Decimal or string; compared to the cent. */
  orderValue: unknown;
  date: Date;
  metadata: unknown;
}

/**
 * Names of the fields that differ between an imported record and what the
 * sheet row now says: "customerName", "orderValue", "date", and
 * "metadata.<key>" for each metadata.fms value (the sheet's raw text).
 * Empty when nothing changed.
 */
export function diffFmsRecord(existing: FmsRecordFields, incoming: FmsRecordFields): string[] {
  const changed: string[] = [];
  if (existing.customerName !== incoming.customerName) changed.push("customerName");
  if (Number(String(existing.orderValue)).toFixed(2) !== Number(String(incoming.orderValue)).toFixed(2)) changed.push("orderValue");
  if (existing.date.getTime() !== incoming.date.getTime()) changed.push("date");
  const before = ((existing.metadata as { fms?: Record<string, unknown> } | null)?.fms ?? {}) as Record<string, unknown>;
  const after = ((incoming.metadata as { fms?: Record<string, unknown> } | null)?.fms ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (comparable(before[key]) !== comparable(after[key])) changed.push(`metadata.${key}`);
  }
  return changed;
}

/**
 * A negative adjustment/reversal row: a Bill No. with a negative Bill Amount.
 * Returns its Bill No., timestamp, amount and customer (may be blank), or
 * null for any other row.
 */
export function fmsAdjustmentRow(row: FmsRawRow): { billNo: string; timestamp: string; amount: number; customerName: string } | null {
  const billNo = cellToString(row[BILL_NO_KEY]).trim();
  const amountText = cellToString(row[BILL_AMOUNT_KEY]).trim();
  const amount = Number(amountText);
  if (!billNo || !amountText || !Number.isFinite(amount) || amount >= 0) return null;
  return { billNo, timestamp: cellToString(row[TIMESTAMP_KEY]).trim(), amount, customerName: cellToString(row[CUSTOMER_NAME_KEY]).trim() };
}

/** Customer names that differ only in case, spaces or punctuation ("V.V. Ind-Tech" = "vv indtech"). */
export function sameCustomerName(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return key(a) === key(b);
}

/** FMS's own cancellation marker (confirmed business rule): Customer Name "CANCELLED" with a blank Bill Amount. */
const CANCELLED_CUSTOMER_NAME = "CANCELLED";

/**
 * If `row` is a cancelled FMS bill — Customer Name exactly "CANCELLED"
 * (case-insensitive, trimmed) AND a blank Bill Amount — returns the
 * externalRef it was imported under, built exactly as normalizeFmsOrderRow
 * builds it ("<Bill No.>|<टाइमस्टैम्प>"). Otherwise (not cancelled, or no
 * Bill No./timestamp to identify it by) returns null. Cell formatting
 * (the sheet's red Bill No.) is never used.
 */
export function cancelledFmsRowExternalRef(row: FmsRawRow): string | null {
  if (cellToString(row[CUSTOMER_NAME_KEY]).trim().toUpperCase() !== CANCELLED_CUSTOMER_NAME) return null;
  if (cellToString(row[BILL_AMOUNT_KEY]).trim() !== "") return null;
  const billNo = cellToString(row[BILL_NO_KEY]).trim();
  const timestamp = cellToString(row[TIMESTAMP_KEY]).trim();
  if (!billNo || !timestamp) return null;
  return `${billNo}|${timestamp}`;
}

/**
 * The Phase 3C-discovered CROSS-SHEET reconciliation bridge:
 * "Bill No. + Bill Amount + Product & Qty" — proven (against all 2,794 real
 * "FMS Response" rows plus the 18 known "Form responses 2" records) to
 * uniquely and correctly identify the same real order across the two
 * differently-labeled, differently-timestamped sheets, with zero collisions.
 *
 * This is used ONLY to check "does this incoming row already correspond to
 * an order already synced (under a different externalRef, from a different
 * sheet)?" — it is NEVER stored as SalesRecord.externalRef and NEVER
 * replaces the existing "Bill No. + टाइमस्टैम्प" identity. Each input is
 * trimmed before joining, matching exactly the methodology validated in the
 * Phase 3C investigation (not a superficially-similar but different
 * comparison).
 */
export function buildReconciliationKey(input: { billNo: string; billAmount: string; productAndQty: string }): string {
  return [input.billNo.trim(), input.billAmount.trim(), input.productAndQty.trim()].join("|");
}
