import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeAccountName, resolveOrCreateAccountCached } from "../leads/account-resolution.service.js";
import type { FmsClient } from "./fms.client.js";
import { normalizeFmsOrderRow } from "./fms-order-sync.util.js";

const ORDERS_SHEET_NAME = "Form responses 2";

/**
 * Large enough to comfortably cover this sheet's real row count today (18,
 * confirmed live) plus realistic near-term growth, while still bounded.
 * Deliberately NOT reusing fms.schema.ts's 1000-row cap — that cap exists
 * for the interactive dashboard-preview route (GET /api/fms/data), not this
 * bulk sync, which needs every row, not a preview page's worth.
 */
const SYNC_FETCH_LIMIT = 10000;

const BILL_NO_KEY = "Bill No.";

export interface FmsOrderSyncResult {
  rowsFetched: number;
  rowsSynced: number;
  rowsSkippedDuplicate: number;
  rowsFailed: number;
  errors: string[];
  accountsCreated: number;
  accountsResolved: number;
  durationMs: number;
}

/**
 * Pulls every row from the "Form responses 2" FMS sheet tab (via the
 * existing, unmodified FmsClient — a single read-only GET, same as the
 * dashboard's Customer & Product Orders card) and upserts them as
 * SalesRecord rows tagged source=FMS_SYNC — one record per FMS bill/order,
 * never one per product line.
 *
 * ## Scope (unchanged since Phase 1 — order-level only)
 * `Customer Name` is resolved/created as an Account (reusing the exact same
 * resolveOrCreateAccountCached used by CSV import). `Bill Amount` is stored
 * as the WHOLE order's `orderValue`, never split across products.
 * `Dispatched Date` is stored as `date`. `productId` stays null (nullable
 * field, no fabricated Product). `quantity` is a fixed `1` — a documented
 * structural placeholder ("one order record"), not a real per-product
 * count; verified (Phase 1 report) that no existing dashboard/intelligence
 * service reads SalesRecord.quantity.
 *
 * ## Phase 2A additions
 * - `externalRef` = "<Bill No.>|<टाइमस्टैम्प>" (see fms-order-sync.util.ts) —
 *   a deterministic identity built ONLY from those two fields, independent
 *   of customer/account resolution, Bill Amount, and Dispatched Date, as
 *   required. Enforced unique per (companyId, source) via a real database
 *   unique index (schema.prisma's `@@unique([companyId, source,
 *   externalRef])`) — not just an application-level check.
 * - `metadata` = `{ fms: {...} }` — the original row's Bill No., timestamp,
 *   Customer Name, the COMPLETE raw "Product and Qty" string, Order Taken,
 *   Dispatched By, Dispatched Date, PDC Cheque Date, and Bill Amount,
 *   preserved verbatim. Never interpreted by this service or any other —
 *   "Product and Qty" is written to this JSON blob and never read back for
 *   any computation.
 *
 * ## Deduplication (now identity-based, with a real DB-level backstop)
 * A `findUnique` on the (companyId, source, externalRef) unique index is
 * checked before every insert — an application-level short-circuit so a
 * genuine re-sync is reported as "skipped duplicate", not an error. The
 * actual guarantee against duplicates is the database's own unique index:
 * even under a race (two syncs running concurrently), a second `create()`
 * for the same externalRef fails with Prisma's P2002 constraint-violation
 * error, which is caught below and counted as a duplicate, not a failure.
 */
export async function syncFmsOrders(prisma: PrismaClient, client: FmsClient, companyId: string): Promise<FmsOrderSyncResult> {
  const startedAt = Date.now();

  const fetchResult = await client.fetchData({ sheet: ORDERS_SHEET_NAME, limit: SYNC_FETCH_LIMIT });
  if (fetchResult.status !== "ok") {
    const message = fetchResult.status === "upstream_rejected" ? `FMS API rejected the request: ${fetchResult.error}` : fetchResult.message;
    throw new Error(`Failed to fetch FMS orders from "${ORDERS_SHEET_NAME}": ${message}`);
  }

  const rows = fetchResult.body.data;
  const errors: string[] = [];
  let rowsSynced = 0;
  let rowsSkippedDuplicate = 0;
  let rowsFailed = 0;
  let accountsCreated = 0;
  let accountsResolved = 0;

  const accountCache = new Map<string, string>();
  const existingAccounts = await prisma.account.findMany({ where: { companyId }, select: { normalizedName: true } });
  const preExistingNormalizedNames = new Set(existingAccounts.map((a) => a.normalizedName));
  // Tracks which distinct customers have already been tallied as
  // created/resolved this run, so a repeat customer across multiple rows in
  // the SAME sync (e.g. two bills for "Krishna Mill Stores") counts once,
  // not once per row — accountsCreated/accountsResolved report distinct
  // customers, not row occurrences.
  const talliedNormalizedNames = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const billNoForLog = row[BILL_NO_KEY] || `row ${i + 1}`;

    const normalized = normalizeFmsOrderRow(row);
    if (!normalized.success) {
      rowsFailed += 1;
      errors.push(`Bill No. ${billNoForLog}: ${normalized.message}`);
      continue;
    }

    try {
      const existingDuplicate = await prisma.salesRecord.findUnique({
        where: {
          companyId_source_externalRef: {
            companyId,
            source: "FMS_SYNC",
            externalRef: normalized.data.externalRef,
          },
        },
      });
      if (existingDuplicate) {
        rowsSkippedDuplicate += 1;
        continue;
      }

      const normalizedName = normalizeAccountName(normalized.data.customerName);
      const accountId = await resolveOrCreateAccountCached(prisma, companyId, { customerName: normalized.data.customerName }, accountCache);
      if (!talliedNormalizedNames.has(normalizedName)) {
        talliedNormalizedNames.add(normalizedName);
        if (preExistingNormalizedNames.has(normalizedName)) {
          accountsResolved += 1;
        } else {
          accountsCreated += 1;
        }
      }

      await prisma.salesRecord.create({
        data: {
          companyId,
          date: normalized.data.date,
          customerName: normalized.data.customerName,
          orderValue: normalized.data.orderValue,
          accountId,
          quantity: 1,
          isNewCustomer: false,
          source: "FMS_SYNC",
          externalRef: normalized.data.externalRef,
          // Prisma's InputJsonObject type requires a string index signature,
          // which a fixed-shape interface (FmsOrderMetadata) intentionally
          // doesn't have — the runtime value is a plain serializable object,
          // this cast only satisfies Prisma's JSON input typing.
          metadata: normalized.data.metadata as unknown as Prisma.InputJsonValue,
        },
      });
      rowsSynced += 1;
    } catch (err) {
      // A concurrent sync could race past the findUnique check above and
      // still collide on the real database unique index — that's the DB
      // doing its job, not a failure, so it's reported the same as the
      // ordinary pre-check duplicate path rather than as an error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        rowsSkippedDuplicate += 1;
        continue;
      }
      rowsFailed += 1;
      errors.push(`Bill No. ${billNoForLog}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    rowsFetched: rows.length,
    rowsSynced,
    rowsSkippedDuplicate,
    rowsFailed,
    errors,
    accountsCreated,
    accountsResolved,
    durationMs: Date.now() - startedAt,
  };
}
