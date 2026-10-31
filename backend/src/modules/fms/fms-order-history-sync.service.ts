import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeAccountName, resolveOrCreateAccountCached } from "../leads/account-resolution.service.js";
import type { FmsRawRow } from "@ai-sales/shared";
import type { FmsClient } from "./fms.client.js";
import {
  normalizeFmsOrderRow,
  buildReconciliationKey,
  cancelledFmsRowExternalRef,
  diffFmsRecord,
  fmsAdjustmentRow,
  fmsRowExternalRef,
  sameCustomerName,
  type FmsOrderMetadata,
} from "./fms-order-sync.util.js";

const HISTORY_SHEET_NAME = "FMS Response";
const CUSTOMER_NAME_KEY = "Customer Name";

/**
 * Large enough to cover this sheet's real row count today (2,794, confirmed
 * live in Phase 3B/3C) plus realistic near-term growth. Same reasoning as
 * fms-order-sync.service.ts's SYNC_FETCH_LIMIT — not the interactive
 * dashboard-preview route's 1000-row cap.
 */
const HISTORY_FETCH_LIMIT = 10000;

const BILL_NO_KEY = "Bill No.";

/**
 * Reviewed spelling variants in "FMS Response" → the existing Account's exact
 * name, so these orders link to that Account instead of creating a duplicate
 * (exact-name matching in account-resolution.service.ts can't see them as the
 * same customer). Keys are normalizeAccountName() of the sheet's Customer
 * Name. The SalesRecord stores the existing name; the sheet's original
 * spelling stays in metadata.fms.customerName. If a target Account doesn't
 * exist, the row fails instead of creating one.
 */
export const CUSTOMER_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  ["sri krishna precision tools and components pvt ltd", "Sri Krishna Precision Tools and Components Pvt. Ltd."],
  ["raj electricals and hardwares", "Raaj Electricals and Hardwares"],
  ["v.v.ind tech co", "V.V.Ind-Tech Co."],
]);

export interface FmsOrderHistorySyncOptions {
  /** Work out every outcome without writing anything (no records, no accounts). */
  dryRun?: boolean;
  /**
   * Treat negative Bill Amount rows as adjustments/reversals of the bill with
   * the same Bill No. (net amount = bill + adjustments) instead of rejecting
   * them as invalid.
   */
  applyAdjustments?: boolean;
}

/** One bill's adjustments as applied (or, in a dry run, as they would be). */
export interface FmsBillAdjustmentSummary {
  billNo: string;
  originalAmount: string;
  adjustmentTotal: string;
  netAmount: string;
  adjustmentRows: number;
}

/** Bill numbers per outcome, for previews, logs and the audit trail (no customer data). */
export interface FmsOrderHistorySyncChanges {
  inserted: string[];
  updated: { billNo: string; fields: string[]; restored: boolean }[];
  /** Records whose Bill No. was corrected in the sheet: same order, new identity (no new record). */
  renumbered: { from: string; to: string }[];
  cancelled: string[];
  /** Stale duplicates of an order another record already represents — marked cancelled, not deleted. */
  superseded: { billNo: string; supersededBy: string }[];
  /** Imported records no row of the sheet corresponds to any more — reported only, never changed. */
  missingFromSheet: string[];
  /** Every bill whose net amount includes negative adjustment rows (informational; changes also show in `updated`). */
  adjusted: FmsBillAdjustmentSummary[];
}

export interface FmsOrderHistorySyncResult {
  dryRun: boolean;
  rowsFetched: number;
  /** New SalesRecords created (or, in a dry run, that would be). */
  rowsSynced: number;
  /** Already-imported records whose fields were changed to match the sheet (includes restores). */
  rowsUpdated: number;
  /** Of rowsUpdated: previously cancelled records whose row is a normal bill again (cancelledAt cleared). */
  rowsRestored: number;
  /** Records given a corrected Bill No. (see changes.renumbered). */
  rowsRenumbered: number;
  /** Stale duplicate records marked cancelled (see changes.superseded). */
  rowsSuperseded: number;
  rowsReconciledToExisting: number;
  /** Already-imported records whose row is unchanged. */
  rowsSkippedDuplicate: number;
  rowsFailed: number;
  /** Cancelled rows whose imported SalesRecord was marked cancelled by this run. */
  rowsMarkedCancelled: number;
  /** Cancelled rows whose SalesRecord was already marked cancelled (a re-run — unchanged). */
  rowsAlreadyCancelled: number;
  /** Cancelled rows that were never imported — nothing to mark, nothing created. */
  rowsCancelledNotImported: number;
  /** Imported records with no matching sheet row (see changes.missingFromSheet). */
  rowsMissingFromSheet: number;
  /** Negative adjustment rows read (applied ones are folded into their bill's net amount). */
  rowsAdjustment: number;
  /** Of rowsAdjustment: rows that couldn't be tied to exactly one bill — reported in `errors`, not applied. */
  rowsAdjustmentUnapplied: number;
  errors: string[];
  accountsCreated: number;
  accountsResolved: number;
  changes: FmsOrderHistorySyncChanges;
  durationMs: number;
}

/** Whether a run changed any stored data (inserts, updates, cancellations). */
export function syncChangedData(result: FmsOrderHistorySyncResult): boolean {
  return !result.dryRun && result.rowsSynced + result.rowsUpdated + result.rowsRenumbered + result.rowsMarkedCancelled + result.rowsSuperseded > 0;
}

/** Same real order: identical timestamp, customer (as written in the sheet), Bill Amount and Product & Qty. */
function orderFingerprint(fms: Pick<FmsOrderMetadata, "timestamp" | "customerName" | "billAmount" | "productAndQty">): string {
  return [fms.timestamp, fms.customerName, fms.billAmount, fms.productAndQty].map((v) => String(v ?? "").trim()).join("\u0000");
}

/**
 * Synchronises the "FMS Response" sheet into SalesRecord — the historical
 * import (Phase 4) and, since the automatic sync, the ongoing one: run it as
 * often as needed, it only writes what the sheet changed. This is a SEPARATE
 * sync path; fms-order-sync.service.ts's syncFmsOrders (the existing "Form
 * responses 2" sync, POST /api/fms/sync) is completely untouched by this file.
 *
 * ## Scope (same order-level-only rules as Phase 1/2A)
 * Same field mapping, same `productId: null` / `quantity: 1` placeholder,
 * same metadata preservation, same "Product and Qty"/"Product & Qty" never
 * interpreted. `normalizeFmsOrderRow` (fms-order-sync.util.ts) already
 * handles both sheets' differing column labels — see that file's
 * PRODUCT_AND_QTY_KEYS/PDC_CHEQUE_DATE_KEYS.
 *
 * ## The reconciliation problem this solves
 * All 18 existing `Form responses 2`-sourced SalesRecord rows were given an
 * externalRef built from THAT sheet's own Bill No. + टाइमस्टैम्प. Phase 3B
 * proved timestamps can drift by seconds between the two sheets for the
 * same real order (e.g. Bill 9: 13:24:39 vs 13:25:25) — so naively syncing
 * "FMS Response" with the same externalRef formula would create a SECOND,
 * duplicate SalesRecord for orders already counted once. Phase 3C proved
 * "Bill No. + Bill Amount + Product & Qty" reconciles all 18 known cases
 * with zero false collisions across the full 2,794-row dataset.
 *
 * Every existing FMS_SYNC record is loaded once, then for each row, in order:
 * 0. Cancellation — FMS marks a cancelled bill with Customer Name
 *    "CANCELLED" and a blank Bill Amount (cancelledFmsRowExternalRef; cell
 *    colour is never used). The record imported under the same externalRef
 *    gets `cancelledAt` set, only if not already set; nothing else about it
 *    changes and nothing is created or deleted. A "CANCELLED" row that still
 *    has a Bill Amount is ambiguous and fails.
 * 1. Exact externalRef match (this sheet's own Bill No.+टाइमस्टैम्प) — the
 *    same imported order. Fields the sheet changed (customer, Bill Amount,
 *    Dispatched Date, metadata) are written to that record; if it was
 *    cancelled, `cancelledAt` is cleared (restored). Unchanged → no write.
 *    A changed customer is re-resolved to its Account exactly as on insert
 *    (aliases included); the previous Account is left as it is.
 * 2. Reconciliation-key match against every EXISTING FMS_SYNC record's
 *    stored `metadata.fms` (regardless of which sheet it originally came
 *    from) — if found, this row is an order ALREADY represented in Postgres
 *    under a different externalRef. It is counted as
 *    `rowsReconciledToExisting`, and — critically — the existing record's
 *    externalRef/metadata are NEVER modified.
 * 3. Otherwise: a genuinely new order — synced as a new SalesRecord with
 *    this sheet's own Bill No.+टाइमस्टैम्प as its externalRef (DB-level
 *    unique index + P2002 backstop against duplicates).
 *    Before inserting, a corrected Bill No. is recognised: if exactly one
 *    imported record that no sheet row matches any more has the same
 *    timestamp, customer (as written), Bill Amount and Product & Qty, the
 *    row IS that order — the record takes the new Bill No./externalRef (and
 *    any other changed fields) instead of a new record being created. If
 *    several match, the row fails rather than guess.
 * After all rows: an imported record no row matches any more, whose order
 * (same fingerprint) another record already represents in the sheet, is a
 * superseded duplicate — marked cancelled (reversible), never deleted.
 * Every other record that no row corresponds to is only reported
 * (`changes.missingFromSheet`) — never cancelled or deleted.
 *
 * Not safe to run twice at once — callers go through
 * fms-auto-sync.ts's runFmsHistorySyncExclusive.
 */
export async function syncFmsOrderHistory(
  prisma: PrismaClient,
  client: FmsClient,
  companyId: string,
  options: FmsOrderHistorySyncOptions = {},
): Promise<FmsOrderHistorySyncResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? false;

  const fetchResult = await client.fetchData({ sheet: HISTORY_SHEET_NAME, limit: HISTORY_FETCH_LIMIT });
  if (fetchResult.status !== "ok") {
    const message = fetchResult.status === "upstream_rejected" ? `FMS API rejected the request: ${fetchResult.error}` : fetchResult.message;
    throw new Error(`Failed to fetch FMS order history from "${HISTORY_SHEET_NAME}": ${message}`);
  }

  const rows = fetchResult.body.data;
  const errors: string[] = [];
  const changes: FmsOrderHistorySyncChanges = { inserted: [], updated: [], renumbered: [], cancelled: [], superseded: [], missingFromSheet: [], adjusted: [] };
  const applyAdjustments = options.applyAdjustments ?? false;
  let rowsAdjustment = 0;
  let rowsAdjustmentUnapplied = 0;

  // Negative adjustment rows, grouped by the Bill No. they adjust. They apply
  // to a bill only when that Bill No. has exactly one original (positive)
  // row and the adjustment's customer is blank or the same customer; any
  // other adjustment is reported, never guessed.
  const adjustmentsByBill = new Map<string, { timestamp: string; amount: number }[]>();
  if (applyAdjustments) {
    const originalsByBill = new Map<string, FmsRawRow[]>();
    for (const row of rows) {
      const billNo = String(row[BILL_NO_KEY] ?? "").trim();
      const amount = Number(String(row["Bill Amount"] ?? "").trim());
      if (billNo && String(row["Bill Amount"] ?? "").trim() !== "" && amount > 0) originalsByBill.set(billNo, [...(originalsByBill.get(billNo) ?? []), row]);
    }
    for (const row of rows) {
      const adjustment = fmsAdjustmentRow(row);
      if (!adjustment) continue;
      rowsAdjustment += 1;
      const originals = originalsByBill.get(adjustment.billNo) ?? [];
      let problem: string | null = null;
      if (originals.length === 0) problem = "no original bill with this Bill No.";
      else if (originals.length > 1) problem = `${originals.length} original rows share this Bill No.`;
      else if (adjustment.customerName && !sameCustomerName(adjustment.customerName, String(originals[0][CUSTOMER_NAME_KEY] ?? ""))) problem = "customer differs from the original bill";
      if (problem) {
        rowsAdjustmentUnapplied += 1;
        errors.push(`Bill No. ${adjustment.billNo}: adjustment ${adjustment.amount} not applied — ${problem}`);
        continue;
      }
      adjustmentsByBill.set(adjustment.billNo, [...(adjustmentsByBill.get(adjustment.billNo) ?? []), { timestamp: adjustment.timestamp, amount: adjustment.amount }]);
    }
  }

  /** Folds a bill's adjustments into its normalized row: orderValue becomes the net; the original Bill Amount stays in metadata. */
  const withAdjustments = (data: NormalizedRow, billNoForLog: string): NormalizedRow => {
    const items = adjustmentsByBill.get(data.metadata.fms.billNo);
    if (!items) return data;
    const total = items.reduce((sum, a) => sum + Math.round(a.amount * 100), 0);
    const netPaise = Math.round(Number(data.orderValue) * 100) + total;
    if (netPaise < 0) {
      rowsAdjustmentUnapplied += items.length;
      errors.push(`Bill No. ${billNoForLog}: adjustments exceed the bill amount (net ${(netPaise / 100).toFixed(2)}) — not applied`);
      return data;
    }
    const netAmount = (netPaise / 100).toFixed(2);
    changes.adjusted.push({ billNo: billNoForLog, originalAmount: data.orderValue, adjustmentTotal: (total / 100).toFixed(2), netAmount, adjustmentRows: items.length });
    return {
      ...data,
      orderValue: netAmount,
      metadata: { fms: { ...data.metadata.fms, adjustments: items.map((a) => ({ timestamp: a.timestamp, amount: a.amount.toFixed(2) })), netAmount } },
    };
  };
  let rowsReconciledToExisting = 0;
  let rowsSkippedDuplicate = 0;
  let rowsFailed = 0;
  let rowsAlreadyCancelled = 0;
  let rowsCancelledNotImported = 0;
  let accountsCreated = 0;
  let accountsResolved = 0;

  // Every existing FMS_SYNC record, by externalRef and by reconciliation key
  // (built the exact same way from its already-preserved metadata —
  // regardless of which sheet it originally came from). One query.
  const existingFmsRecords = await prisma.salesRecord.findMany({
    where: { companyId, source: "FMS_SYNC" },
    select: { id: true, externalRef: true, customerName: true, orderValue: true, date: true, accountId: true, cancelledAt: true, metadata: true },
  });
  type ExistingRecord = (typeof existingFmsRecords)[number];
  const byExternalRef = new Map<string, ExistingRecord>();
  const byReconciliationKey = new Map<string, ExistingRecord>();
  for (const record of existingFmsRecords) {
    if (record.externalRef) byExternalRef.set(record.externalRef, record);
    const meta = record.metadata as { fms?: FmsOrderMetadata } | null;
    if (!meta?.fms) continue;
    byReconciliationKey.set(
      buildReconciliationKey({ billNo: meta.fms.billNo, billAmount: meta.fms.billAmount, productAndQty: meta.fms.productAndQty }),
      record,
    );
  }
  const knownReconciliationKeys = new Set(byReconciliationKey.keys());
  const stillInSheet = new Set<string>(); // record ids some row still corresponds to

  // Records no sheet row matches by identity, by order fingerprint — the
  // only records a corrected Bill No. can belong to, or that can be a
  // superseded duplicate.
  const sheetRefs = new Set(rows.map(fmsRowExternalRef).filter((ref): ref is string => ref !== null));
  const unmatchedByFingerprint = new Map<string, ExistingRecord[]>();
  for (const record of existingFmsRecords) {
    if (record.externalRef && sheetRefs.has(record.externalRef)) continue;
    const fms = (record.metadata as { fms?: FmsOrderMetadata } | null)?.fms;
    if (!fms) continue;
    const fingerprint = orderFingerprint(fms);
    unmatchedByFingerprint.set(fingerprint, [...(unmatchedByFingerprint.get(fingerprint) ?? []), record]);
  }
  const renumberedIds = new Set<string>();
  // fingerprint → Bill No. of the record that now represents that order in the sheet
  const representedFingerprints = new Map<string, string>();

  const accountCache = new Map<string, string>();
  const existingAccounts = await prisma.account.findMany({ where: { companyId }, select: { normalizedName: true } });
  const preExistingNormalizedNames = new Set(existingAccounts.map((a) => a.normalizedName));
  const talliedNormalizedNames = new Set<string>();

  /** Applies CUSTOMER_NAME_ALIASES; null (with the row failed) when an alias's target Account is missing. */
  const canonicalCustomerName = (sheetName: string, billNoForLog: string): string | null => {
    const alias = CUSTOMER_NAME_ALIASES.get(normalizeAccountName(sheetName));
    if (alias && !preExistingNormalizedNames.has(normalizeAccountName(alias))) {
      rowsFailed += 1;
      errors.push(`Bill No. ${billNoForLog}: alias target account "${alias}" not found`);
      return null;
    }
    return alias ?? sheetName;
  };

  /** Finds or (outside a dry run) creates the Account, tallying each distinct customer once. */
  const resolveAccount = async (customerName: string): Promise<string | null> => {
    const normalizedName = normalizeAccountName(customerName);
    if (!talliedNormalizedNames.has(normalizedName)) {
      talliedNormalizedNames.add(normalizedName);
      if (preExistingNormalizedNames.has(normalizedName)) accountsResolved += 1;
      else accountsCreated += 1;
    }
    if (dryRun) return null;
    return resolveOrCreateAccountCached(prisma, companyId, { customerName }, accountCache);
  };

  type NormalizedRow = Extract<ReturnType<typeof normalizeFmsOrderRow>, { success: true }>["data"];
  /**
   * Brings `record` in line with the row: changed fields, restoring it if it
   * was cancelled, and — for a corrected Bill No. — its new identity.
   * Returns the changed field names (empty: nothing written).
   */
  const updateRecordFromRow = async (record: ExistingRecord, row: NormalizedRow, customerName: string, renumber: boolean): Promise<string[]> => {
    const incoming = { customerName, orderValue: row.orderValue, date: row.date, metadata: row.metadata };
    const fields = diffFmsRecord(record, incoming);
    const restored = record.cancelledAt !== null;
    if (fields.length === 0 && !restored && !renumber) return [];
    const data: Prisma.SalesRecordUncheckedUpdateInput = {};
    if (fields.includes("customerName")) {
      data.customerName = customerName;
      const accountId = await resolveAccount(customerName);
      if (!dryRun) data.accountId = accountId;
    }
    if (fields.includes("orderValue")) data.orderValue = row.orderValue;
    if (fields.includes("date")) data.date = row.date;
    if (fields.some((f) => f.startsWith("metadata."))) data.metadata = row.metadata as unknown as Prisma.InputJsonValue;
    if (renumber) data.externalRef = row.externalRef;
    if (restored) data.cancelledAt = null;
    if (!dryRun) await prisma.salesRecord.update({ where: { id: record.id }, data });
    return restored ? [...fields, "cancelledAt"] : fields;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const billNoForLog = String(row[BILL_NO_KEY] || `row ${i + 1}`);

    const rowRef = fmsRowExternalRef(row);
    const sameRecord = rowRef ? byExternalRef.get(rowRef) : undefined;
    if (sameRecord) stillInSheet.add(sameRecord.id);

    try {
      // Adjustment rows are folded into their bill above (or reported) — never a sale of their own.
      if (applyAdjustments && fmsAdjustmentRow(row)) continue;

      const cancelledRef = cancelledFmsRowExternalRef(row);
      if (cancelledRef) {
        if (!sameRecord) {
          rowsCancelledNotImported += 1;
        } else if (sameRecord.cancelledAt) {
          rowsAlreadyCancelled += 1;
        } else {
          if (!dryRun) {
            await prisma.salesRecord.updateMany({ where: { id: sameRecord.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
          }
          changes.cancelled.push(billNoForLog);
        }
        continue;
      }
      if (String(row[CUSTOMER_NAME_KEY] ?? "").trim().toUpperCase() === "CANCELLED") {
        rowsFailed += 1;
        errors.push(`Bill No. ${billNoForLog}: Customer Name is "CANCELLED" but Bill Amount is not blank — not treated as a sale or a cancellation`);
        continue;
      }

      const normalized = normalizeFmsOrderRow(row);
      if (!normalized.success) {
        rowsFailed += 1;
        errors.push(`Bill No. ${billNoForLog}: ${normalized.message}`);
        continue;
      }
      normalized.data = withAdjustments(normalized.data, billNoForLog);

      const fingerprint = orderFingerprint(normalized.data.metadata.fms);

      if (sameRecord) {
        representedFingerprints.set(fingerprint, billNoForLog);
        const customerName = canonicalCustomerName(normalized.data.customerName, billNoForLog);
        if (customerName === null) continue;
        const restored = sameRecord.cancelledAt !== null;
        const fields = await updateRecordFromRow(sameRecord, normalized.data, customerName, false);
        if (fields.length === 0) rowsSkippedDuplicate += 1;
        else changes.updated.push({ billNo: billNoForLog, fields: fields.filter((f) => f !== "cancelledAt"), restored });
        continue;
      }

      const reconciliationKey = buildReconciliationKey({
        billNo: normalized.data.metadata.fms.billNo,
        billAmount: normalized.data.metadata.fms.billAmount,
        productAndQty: normalized.data.metadata.fms.productAndQty,
      });
      if (knownReconciliationKeys.has(reconciliationKey)) {
        const target = byReconciliationKey.get(reconciliationKey);
        if (target) stillInSheet.add(target.id);
        rowsReconciledToExisting += 1;
        continue;
      }

      const customerName = canonicalCustomerName(normalized.data.customerName, billNoForLog);
      if (customerName === null) continue;

      // A corrected Bill No.: the same order as exactly one record the sheet no longer has.
      const candidates = (unmatchedByFingerprint.get(fingerprint) ?? []).filter((r) => !renumberedIds.has(r.id));
      if (candidates.length > 1) {
        rowsFailed += 1;
        errors.push(`Bill No. ${billNoForLog}: matches ${candidates.length} imported records with the same timestamp, customer, amount and product — not inserted`);
        continue;
      }
      if (candidates.length === 1) {
        const [previous] = candidates;
        await updateRecordFromRow(previous, normalized.data, customerName, true);
        renumberedIds.add(previous.id);
        stillInSheet.add(previous.id);
        representedFingerprints.set(fingerprint, billNoForLog);
        changes.renumbered.push({ from: previous.externalRef?.split("|")[0] ?? previous.id, to: billNoForLog });
        continue;
      }

      const accountId = await resolveAccount(customerName);

      if (!dryRun) {
        await prisma.salesRecord.create({
          data: {
            companyId,
            date: normalized.data.date,
            customerName,
            orderValue: normalized.data.orderValue,
            accountId,
            quantity: 1,
            isNewCustomer: false,
            source: "FMS_SYNC",
            externalRef: normalized.data.externalRef,
            metadata: normalized.data.metadata as unknown as Prisma.InputJsonValue,
          },
        });
      }
      // A row just synced is now itself part of "known" state for any
      // later row in this SAME run that might reconcile against it (e.g.
      // two rows in this sheet that are themselves duplicates of each
      // other) — keeps a single sync run internally consistent.
      knownReconciliationKeys.add(reconciliationKey);
      representedFingerprints.set(fingerprint, billNoForLog);
      changes.inserted.push(billNoForLog);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        rowsSkippedDuplicate += 1;
        continue;
      }
      rowsFailed += 1;
      errors.push(`Bill No. ${billNoForLog}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const record of existingFmsRecords) {
    if (stillInSheet.has(record.id)) continue;
    const billNo = record.externalRef?.split("|")[0] ?? record.id;
    const fms = (record.metadata as { fms?: FmsOrderMetadata } | null)?.fms;
    const supersededBy = fms ? representedFingerprints.get(orderFingerprint(fms)) : undefined;
    if (!supersededBy) {
      changes.missingFromSheet.push(billNo);
      continue;
    }
    if (record.cancelledAt) continue; // superseded on an earlier run
    try {
      if (!dryRun) await prisma.salesRecord.updateMany({ where: { id: record.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      changes.superseded.push({ billNo, supersededBy });
    } catch (err) {
      rowsFailed += 1;
      errors.push(`Bill No. ${billNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    dryRun,
    rowsFetched: rows.length,
    rowsSynced: changes.inserted.length,
    rowsUpdated: changes.updated.length,
    rowsRestored: changes.updated.filter((u) => u.restored).length,
    rowsRenumbered: changes.renumbered.length,
    rowsSuperseded: changes.superseded.length,
    rowsReconciledToExisting,
    rowsSkippedDuplicate,
    rowsFailed,
    rowsMarkedCancelled: changes.cancelled.length,
    rowsAlreadyCancelled,
    rowsCancelledNotImported,
    rowsMissingFromSheet: changes.missingFromSheet.length,
    rowsAdjustment,
    rowsAdjustmentUnapplied,
    errors,
    accountsCreated,
    accountsResolved,
    changes,
    durationMs: Date.now() - startedAt,
  };
}
