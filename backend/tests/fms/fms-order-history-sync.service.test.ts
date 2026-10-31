/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { syncFmsOrderHistory } from "../../src/modules/fms/fms-order-history-sync.service.js";
import type { FetchFmsDataResult, FmsClient, FmsApiSuccessBody } from "../../src/modules/fms/fms.client.js";
import type { FmsRawRow } from "@ai-sales/shared";

function makeFakeClient(rows: FmsRawRow[]): FmsClient {
  const body: FmsApiSuccessBody = { success: true, sheet: "FMS Response", count: rows.length, totalRows: rows.length, data: rows };
  const result: FetchFmsDataResult = { status: "ok", body };
  return { fetchData: vi.fn(async () => result) };
}

/** Mirrors fms-order-sync.service.test.ts's makeFakeDeps, extended with `account.findMany`/`salesRecord.findMany` seeding for pre-existing FMS_SYNC records (needed to test reconciliation). */
function makeFakeDeps() {
  const accounts: any[] = [];
  const salesRecords: any[] = [];
  let nextAccountId = 1;
  let nextRecordId = 1;

  const prisma = {
    account: {
      findMany: vi.fn(async (args: any) => accounts.filter((a) => a.companyId === args.where.companyId).map((a) => ({ normalizedName: a.normalizedName }))),
      findUnique: vi.fn(async (args: any) => {
        const { companyId, normalizedName } = args.where.companyId_normalizedName;
        return accounts.find((a) => a.companyId === companyId && a.normalizedName === normalizedName) ?? null;
      }),
      create: vi.fn(async (args: any) => {
        const row = { id: `acc_${nextAccountId++}`, ...args.data };
        accounts.push(row);
        return row;
      }),
      update: vi.fn(async (args: any) => {
        const row = accounts.find((a) => a.id === args.where.id);
        Object.assign(row, args.data);
        return row;
      }),
    },
    salesRecord: {
      findMany: vi.fn(async (args: any) =>
        salesRecords
          .filter((r) => r.companyId === args.where.companyId && r.source === args.where.source)
          .map((r) => ({ cancelledAt: null, date: new Date(r.metadata?.fms?.dispatchedDate ?? 0), ...r })),
      ),
      update: vi.fn(async (args: any) => {
        const row = salesRecords.find((r) => r.id === args.where.id);
        Object.assign(row, args.data);
        return row;
      }),
      findUnique: vi.fn(async (args: any) => {
        const { companyId, source, externalRef } = args.where.companyId_source_externalRef;
        return salesRecords.find((r) => r.companyId === companyId && r.source === source && r.externalRef === externalRef) ?? null;
      }),
      create: vi.fn(async (args: any) => {
        const { companyId, source, externalRef } = args.data;
        const collision = salesRecords.find((r) => r.companyId === companyId && r.source === source && r.externalRef === externalRef);
        if (collision) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0" });
        }
        const row = { id: `sr_${nextRecordId++}`, ...args.data };
        salesRecords.push(row);
        return row;
      }),
      updateMany: vi.fn(async (args: any) => {
        const { id, cancelledAt } = args.where;
        const hits = salesRecords.filter((r) => r.id === id && (cancelledAt !== null || r.cancelledAt == null));
        hits.forEach((r) => Object.assign(r, args.data));
        return { count: hits.length };
      }),
      findFirst: vi.fn(async (args: any) => {
        const { companyId, source, externalRef } = args.where;
        return salesRecords.find((r) => r.companyId === companyId && r.source === source && r.externalRef === externalRef) ?? null;
      }),
    },
  };

  return { prisma, accounts, salesRecords };
}

/** A "Form responses 2"-shaped pre-existing record, as Phase 2A would have created — this is what reconciliation must match against. */
function seedExistingFmsSyncRecord(salesRecords: any[], overrides: Partial<Record<string, unknown>> = {}) {
  salesRecords.push({
    id: `sr_existing_${salesRecords.length}`,
    companyId: "c1",
    source: "FMS_SYNC",
    externalRef: "1|2026-04-01 11:38:21", // Form responses 2's own timestamp
    customerName: "Krishna Mill Stores",
    orderValue: "95391.00",
    metadata: {
      fms: {
        billNo: "1",
        timestamp: "2026-04-01 11:38:21",
        customerName: "Krishna Mill Stores",
        productAndQty: "R (3.15) - 21 Box\nC (0.80) - 11\nC (1.20) - 11",
        orderTaken: "Aditya",
        dispatchedBy: "Ram",
        dispatchedDate: "2026-04-01 00:00:00",
        pdcChequeDate: "",
        billAmount: "95391",
      },
    },
    ...overrides,
  });
}

function fmsResponseRow(overrides: Partial<Record<string, unknown>> = {}): FmsRawRow {
  return {
    "टाइमस्टैम्प": "2026-04-01 11:38:21",
    "Bill No.": 1,
    "Customer Name": "Krishna Mill Stores",
    "Product & Qty": "R (3.15) - 21 Box\nC (0.80) - 11\nC (1.20) - 11",
    "Bill Amount": 95391,
    "Order Taken": "Aditya",
    "Dispatched By": "Suresh", // FMS Response's own field, can legitimately differ from the existing record
    "Dispatched Date": "2026-04-01 00:00:00",
    "PDC Cheque": "",
    ...overrides,
  } as unknown as FmsRawRow;
}

describe("syncFmsOrderHistory", () => {
  it("syncs a genuinely new order (no reconciliation match) as a new SalesRecord", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([fmsResponseRow({ "Bill No.": 500, "टाइमस्टैम्प": "2026-06-01 10:00:00", "Customer Name": "Brand New Customer", "Bill Amount": 5000 })]);

    const result = await syncFmsOrderHistory(prisma as any, client, "c1");

    expect(result).toMatchObject({ rowsFetched: 1, rowsSynced: 1, rowsReconciledToExisting: 0, rowsSkippedDuplicate: 0, rowsFailed: 0 });
    expect(salesRecords).toHaveLength(1);
    expect(salesRecords[0].source).toBe("FMS_SYNC");
    expect(salesRecords[0].externalRef).toBe("500|2026-06-01 10:00:00");
  });

  it("reconciles an incoming row (with drifted timestamp AND a different Dispatched By) to an existing record — does not create a duplicate, does not touch the existing record", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    seedExistingFmsSyncRecord(salesRecords); // externalRef 1|2026-04-01 11:38:21 (Form responses 2's timestamp)
    const originalExisting = { ...salesRecords[0] };

    // The exact real-world case from Phase 3B: same order, but FMS Response's
    // own timestamp differs by ~46s, and Dispatched By differs (Ram vs Suresh).
    const client = makeFakeClient([fmsResponseRow({ "टाइमस्टैम्प": "2026-04-01 11:38:25", "Dispatched By": "Suresh" })]);

    const result = await syncFmsOrderHistory(prisma as any, client, "c1");

    expect(result.rowsReconciledToExisting).toBe(1);
    expect(result.rowsSynced).toBe(0);
    expect(salesRecords).toHaveLength(1); // no second record created
    expect(salesRecords[0]).toEqual(originalExisting); // existing record completely untouched — externalRef/metadata unchanged
  });

  it("running the historical sync twice against identical data does not create duplicates the second time (exact externalRef re-run idempotency)", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const rows = [fmsResponseRow({ "Bill No.": 500, "टाइमस्टैम्प": "2026-06-01 10:00:00", "Customer Name": "Brand New Customer", "Bill Amount": 5000 })];

    const first = await syncFmsOrderHistory(prisma as any, makeFakeClient(rows), "c1");
    expect(first.rowsSynced).toBe(1);

    const second = await syncFmsOrderHistory(prisma as any, makeFakeClient(rows), "c1");
    expect(second.rowsSynced).toBe(0);
    expect(second.rowsSkippedDuplicate).toBe(1);
    expect(salesRecords).toHaveLength(1);
  });

  it("a blank/invalid row is skipped safely without aborting the rest of the batch", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const blankRow = { "टाइमस्टैम्प": "", "Bill No.": "", "Customer Name": "", "Product & Qty": "", "Bill Amount": "", "Order Taken": "", "Dispatched By": "", "Dispatched Date": "", "PDC Cheque": "" } as unknown as FmsRawRow;
    const missingAmountRow = fmsResponseRow({ "Bill No.": 2251, "टाइमस्टैम्प": "2026-06-02 10:00:00" });
    delete (missingAmountRow as Record<string, unknown>)["Bill Amount"];
    const validRow = fmsResponseRow({ "Bill No.": 500, "टाइमस्टैम्प": "2026-06-01 10:00:00", "Customer Name": "Brand New Customer", "Bill Amount": 5000 });

    const client = makeFakeClient([blankRow, missingAmountRow, validRow]);
    const result = await syncFmsOrderHistory(prisma as any, client, "c1");

    expect(result.rowsFailed).toBe(2);
    expect(result.rowsSynced).toBe(1);
    expect(salesRecords).toHaveLength(1);
  });

  it("existing MANUAL/CSV_IMPORT records are never read or touched", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const manualRecord = { id: "sr_manual", companyId: "c1", source: "MANUAL", customerName: "Existing Manual Customer", orderValue: "500.00" };
    salesRecords.push(manualRecord);

    await syncFmsOrderHistory(prisma as any, makeFakeClient([fmsResponseRow({ "Bill No.": 500, "टाइमस्टैम्प": "2026-06-01 10:00:00", "Bill Amount": 5000 })]), "c1");

    expect(salesRecords.find((r) => r.id === "sr_manual")).toEqual(manualRecord);
  });

  it("Product & Qty is preserved verbatim in metadata for newly-synced rows, never interpreted (no productId, quantity stays the documented placeholder)", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const raw = "C (0.80) (12.5) NW70 - 5";
    const client = makeFakeClient([fmsResponseRow({ "Bill No.": 500, "टाइमस्टैम्प": "2026-06-01 10:00:00", "Bill Amount": 5000, "Product & Qty": raw })]);

    await syncFmsOrderHistory(prisma as any, client, "c1");

    expect(salesRecords[0].productId).toBeUndefined();
    expect(salesRecords[0].quantity).toBe(1);
    expect(salesRecords[0].metadata.fms.productAndQty).toBe(raw);
  });

  it("reconciliation is based on Bill No. + Bill Amount + Product & Qty — NOT Bill No. + Timestamp — so timestamp drift alone never blocks reconciliation, and a genuinely different order with the same Bill No. is NOT wrongly reconciled", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    seedExistingFmsSyncRecord(salesRecords); // Bill 1, amount 95391, product "R (3.15) - 21 Box\n..."

    // Same Bill No., but a genuinely different order (different amount, different product) — the real Phase 3B "1278"-style collision case.
    const client = makeFakeClient([
      fmsResponseRow({ "Bill No.": 1, "टाइमस्टैम्प": "2026-06-01 09:00:00", "Customer Name": "A Totally Different Customer", "Bill Amount": 777, "Product & Qty": "SS 308 (4.00) - 1 Pkt" }),
    ]);

    const result = await syncFmsOrderHistory(prisma as any, client, "c1");

    expect(result.rowsReconciledToExisting).toBe(0); // must NOT be treated as the same order
    expect(result.rowsSynced).toBe(1); // synced as a genuinely new, separate order
    expect(salesRecords).toHaveLength(2);
  });

  it("links a reviewed spelling variant (CUSTOMER_NAME_ALIASES) to the existing account instead of creating a duplicate", async () => {
    const { prisma, accounts, salesRecords } = makeFakeDeps();
    accounts.push({ id: "acc_existing", companyId: "c1", name: "Raaj Electricals and Hardwares", normalizedName: "raaj electricals and hardwares" });
    const client = makeFakeClient([fmsResponseRow({ "Bill No.": 2926, "टाइमस्टैम्प": "2026-09-26 13:00:06", "Customer Name": "Raj Electricals And Hardwares", "Bill Amount": 8231 })]);

    const result = await syncFmsOrderHistory(prisma as any, client, "c1");

    expect(result).toMatchObject({ rowsSynced: 1, rowsFailed: 0, accountsCreated: 0, accountsResolved: 1 });
    expect(accounts).toHaveLength(1);
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(salesRecords[0]).toMatchObject({ accountId: "acc_existing", customerName: "Raaj Electricals and Hardwares" });
    expect(salesRecords[0].metadata.fms.customerName).toBe("Raj Electricals And Hardwares"); // sheet spelling preserved
  });

  it("marks an imported bill that FMS now shows as CANCELLED (blank Bill Amount) as cancelled, keeping the record and all its fields, and creates nothing", async () => {
    const { prisma, accounts, salesRecords } = makeFakeDeps();
    seedExistingFmsSyncRecord(salesRecords, { accountId: "acc_x" });
    const before = JSON.parse(JSON.stringify(salesRecords[0]));
    const cancelledRow = fmsResponseRow({ "Customer Name": "CANCELLED", "Bill Amount": "", "Product & Qty": "", "Order Taken": "", "Dispatched By": "", "Dispatched Date": "" });

    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([cancelledRow]), "c1");

    expect(result).toMatchObject({ rowsMarkedCancelled: 1, rowsAlreadyCancelled: 0, rowsCancelledNotImported: 0, rowsSynced: 0, rowsFailed: 0 });
    expect(result.errors).toEqual([]);
    expect(salesRecords).toHaveLength(1);
    expect(accounts).toHaveLength(0);
    expect(salesRecords[0].cancelledAt).toBeInstanceOf(Date);
    const { cancelledAt: _c, ...rest } = salesRecords[0];
    expect(rest).toEqual(before); // customer, amount, account, metadata unchanged
  });

  it("is idempotent: re-running over an already-cancelled bill changes nothing", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    seedExistingFmsSyncRecord(salesRecords);
    const client = makeFakeClient([fmsResponseRow({ "Customer Name": "CANCELLED", "Bill Amount": "" })]);

    await syncFmsOrderHistory(prisma as any, client, "c1");
    const firstCancelledAt = salesRecords[0].cancelledAt;
    const second = await syncFmsOrderHistory(prisma as any, client, "c1");

    expect(second).toMatchObject({ rowsMarkedCancelled: 0, rowsAlreadyCancelled: 1, rowsSynced: 0, rowsFailed: 0 });
    expect(salesRecords).toHaveLength(1);
    expect(salesRecords[0].cancelledAt).toBe(firstCancelledAt);
  });

  it("a cancelled bill that was never imported is counted, not created and not an error", async () => {
    const { prisma, accounts, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([fmsResponseRow({ "Bill No.": 2251, "टाइमस्टैम्प": "2026-08-17 13:36:03", "Customer Name": "CANCELLED", "Bill Amount": "" })]);

    const result = await syncFmsOrderHistory(prisma as any, client, "c1");

    expect(result).toMatchObject({ rowsCancelledNotImported: 1, rowsMarkedCancelled: 0, rowsSynced: 0, rowsFailed: 0 });
    expect(salesRecords).toHaveLength(0);
    expect(accounts).toHaveLength(0);
  });

  it("a CANCELLED row that still has a Bill Amount is rejected — neither imported as a sale for customer \"CANCELLED\" nor treated as a cancellation", async () => {
    const { prisma, accounts, salesRecords } = makeFakeDeps();
    seedExistingFmsSyncRecord(salesRecords);
    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([fmsResponseRow({ "Customer Name": "CANCELLED" })]), "c1");

    expect(result).toMatchObject({ rowsFailed: 1, rowsMarkedCancelled: 0, rowsSynced: 0 });
    expect(salesRecords[0].cancelledAt).toBeUndefined();
    expect(accounts).toHaveLength(0);
  });

  it("fails an aliased row rather than creating an account when the alias's target account doesn't exist", async () => {
    const { prisma, accounts, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([fmsResponseRow({ "Bill No.": 3060, "टाइमस्टैम्प": "2026-10-07 11:27:20", "Customer Name": "V.V.Ind tech Co", "Bill Amount": 48238 })]);

    const result = await syncFmsOrderHistory(prisma as any, client, "c1");

    expect(result).toMatchObject({ rowsSynced: 0, rowsFailed: 1 });
    expect(result.errors[0]).toContain('alias target account "V.V.Ind-Tech Co." not found');
    expect(accounts).toHaveLength(0);
    expect(salesRecords).toHaveLength(0);
  });
});

describe("syncFmsOrderHistory — keeping imported bills in step with the sheet", () => {
  /** One already-imported FMS Response record (Bill 1 as fmsResponseRow() describes it), optionally cancelled. */
  async function importedOnce(extraRows: FmsRawRow[] = []) {
    const deps = makeFakeDeps();
    await syncFmsOrderHistory(deps.prisma as any, makeFakeClient([fmsResponseRow(), ...extraRows]), "c1");
    deps.prisma.salesRecord.create.mockClear();
    deps.prisma.account.create.mockClear();
    return deps;
  }

  it("updates the same record when an imported bill is edited — no duplicate, only the changed fields", async () => {
    const { prisma, salesRecords } = await importedOnce();
    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([fmsResponseRow({ "Order Taken": "Priya", "Bill Amount": 96000, "Dispatched Date": "2026-04-02 00:00:00" })]), "c1");

    expect(result).toMatchObject({ rowsUpdated: 1, rowsSynced: 0, rowsSkippedDuplicate: 0, rowsFailed: 0 });
    expect(result.changes.updated).toEqual([{ billNo: "1", fields: ["orderValue", "date", "metadata.orderTaken", "metadata.dispatchedDate", "metadata.billAmount"], restored: false }]);
    expect(salesRecords).toHaveLength(1);
    expect(prisma.salesRecord.create).not.toHaveBeenCalled();
    expect(salesRecords[0]).toMatchObject({ orderValue: "96000.00", customerName: "Krishna Mill Stores" });
    expect(salesRecords[0].metadata.fms).toMatchObject({ orderTaken: "Priya", billAmount: "96000", dispatchedDate: "2026-04-02 00:00:00" });
    expect(salesRecords[0].date).toEqual(new Date("2026-04-02 00:00:00"));
  });

  it("writes nothing when nothing changed — a second run is a no-op", async () => {
    const { prisma } = await importedOnce();
    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([fmsResponseRow()]), "c1");

    expect(result).toMatchObject({ rowsUpdated: 0, rowsSkippedDuplicate: 1, rowsSynced: 0 });
    expect(prisma.salesRecord.update).not.toHaveBeenCalled();
    expect(prisma.salesRecord.create).not.toHaveBeenCalled();
  });

  it("re-links the account when Customer Name changes, creating one only for a genuinely new customer", async () => {
    const { prisma, salesRecords, accounts } = await importedOnce();
    const oldAccountId = salesRecords[0].accountId;
    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([fmsResponseRow({ "Customer Name": "Krishna Mills Pvt Ltd" })]), "c1");

    expect(result).toMatchObject({ rowsUpdated: 1, accountsCreated: 1 });
    expect(salesRecords[0].customerName).toBe("Krishna Mills Pvt Ltd");
    expect(salesRecords[0].accountId).not.toBe(oldAccountId);
    expect(accounts).toHaveLength(2); // the previous account is left as it was
  });

  it("an aliased spelling is not a change: the record keeps its existing account and name", async () => {
    const deps = makeFakeDeps();
    deps.accounts.push({ id: "acc_existing", companyId: "c1", name: "Raaj Electricals and Hardwares", normalizedName: "raaj electricals and hardwares" });
    const row = fmsResponseRow({ "Bill No.": 2926, "टाइमस्टैम्प": "2026-09-26 13:00:06", "Customer Name": "Raj Electricals And Hardwares", "Bill Amount": 8231 });
    await syncFmsOrderHistory(deps.prisma as any, makeFakeClient([row]), "c1");

    const second = await syncFmsOrderHistory(deps.prisma as any, makeFakeClient([row]), "c1");

    expect(second).toMatchObject({ rowsUpdated: 0, rowsSkippedDuplicate: 1, accountsCreated: 0 });
    expect(deps.salesRecords[0]).toMatchObject({ accountId: "acc_existing", customerName: "Raaj Electricals and Hardwares" });
  });

  it("restores a cancelled bill whose row is a normal bill again (cancelledAt cleared), without a duplicate", async () => {
    const { prisma, salesRecords } = await importedOnce();
    await syncFmsOrderHistory(prisma as any, makeFakeClient([fmsResponseRow({ "Customer Name": "CANCELLED", "Bill Amount": "" })]), "c1");
    expect(salesRecords[0].cancelledAt).toBeInstanceOf(Date);

    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([fmsResponseRow()]), "c1");

    expect(result).toMatchObject({ rowsUpdated: 1, rowsRestored: 1, rowsSynced: 0 });
    expect(result.changes.updated[0]).toMatchObject({ billNo: "1", restored: true });
    expect(salesRecords).toHaveLength(1);
    expect(salesRecords[0].cancelledAt).toBeNull();
  });

  it("reports imported records that no longer have a sheet row, without changing them", async () => {
    const { prisma, salesRecords } = await importedOnce([fmsResponseRow({ "Bill No.": 2, "टाइमस्टैम्प": "2026-04-01 12:00:00", "Bill Amount": 500 })]);
    const before = JSON.parse(JSON.stringify(salesRecords));

    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([fmsResponseRow()]), "c1");

    expect(result).toMatchObject({ rowsMissingFromSheet: 1, rowsUpdated: 0, rowsMarkedCancelled: 0 });
    expect(result.changes.missingFromSheet).toEqual(["2"]);
    expect(JSON.parse(JSON.stringify(salesRecords))).toEqual(before);
  });

  it("a dry run reports every outcome but writes nothing", async () => {
    const { prisma, salesRecords, accounts } = await importedOnce();
    const before = JSON.parse(JSON.stringify(salesRecords));
    const rows = [
      fmsResponseRow({ "Order Taken": "Priya" }),
      fmsResponseRow({ "Bill No.": 700, "टाइमस्टैम्प": "2026-10-01 10:00:00", "Customer Name": "Fresh Customer", "Bill Amount": 1200 }),
    ];

    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient(rows), "c1", { dryRun: true });

    expect(result).toMatchObject({ dryRun: true, rowsUpdated: 1, rowsSynced: 1, accountsCreated: 1 });
    expect(result.changes.inserted).toEqual(["700"]);
    expect(prisma.salesRecord.create).not.toHaveBeenCalled();
    expect(prisma.salesRecord.update).not.toHaveBeenCalled();
    expect(prisma.salesRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(salesRecords))).toEqual(before);
    expect(accounts).toHaveLength(1);
  });
});

describe("syncFmsOrderHistory — corrected Bill Numbers", () => {
  const order = (bill: number, overrides: Record<string, unknown> = {}) =>
    fmsResponseRow({ "Bill No.": bill, "टाइमस्टैम्प": "2026-07-11 19:05:39", "Customer Name": "John Traders", "Product & Qty": "R (2.0) - 5", "Bill Amount": 10974, ...overrides });

  it("gives the existing record the corrected Bill No. instead of inserting a duplicate (1655 → 1656)", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1655)]), "c1");
    const { id, accountId } = salesRecords[0];
    prisma.salesRecord.create.mockClear();

    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1656)]), "c1");

    expect(result).toMatchObject({ rowsRenumbered: 1, rowsSynced: 0, rowsMissingFromSheet: 0, rowsSuperseded: 0 });
    expect(result.changes.renumbered).toEqual([{ from: "1655", to: "1656" }]);
    expect(prisma.salesRecord.create).not.toHaveBeenCalled();
    expect(salesRecords).toHaveLength(1);
    expect(salesRecords[0]).toMatchObject({ id, accountId, externalRef: "1656|2026-07-11 19:05:39" });
    expect(salesRecords[0].metadata.fms.billNo).toBe("1656");

    const again = await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1656)]), "c1");
    expect(again).toMatchObject({ rowsRenumbered: 0, rowsSkippedDuplicate: 1, rowsSynced: 0 });
  });

  it("does not renumber when the amount, product or customer differ — that is a different order", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1655)]), "c1");

    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1656, { "Bill Amount": 10975 })]), "c1");

    expect(result).toMatchObject({ rowsRenumbered: 0, rowsSynced: 1, rowsMissingFromSheet: 1 });
    expect(salesRecords).toHaveLength(2);
  });

  it("refuses to guess when several missing records match the corrected row", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1655), order(1700)]), "c1");

    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1656)]), "c1");

    expect(result).toMatchObject({ rowsRenumbered: 0, rowsSynced: 0, rowsFailed: 1 });
    expect(result.errors[0]).toContain("matches 2 imported records");
    expect(salesRecords).toHaveLength(2);
  });

  it("marks a stale duplicate cancelled (not deleted) when its corrected twin is already imported (1278 / 1279)", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1278), order(1279)]), "c1"); // both imported earlier
    expect(salesRecords).toHaveLength(2);

    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1279)]), "c1");

    expect(result).toMatchObject({ rowsSuperseded: 1, rowsMissingFromSheet: 0, rowsSynced: 0, rowsRenumbered: 0 });
    expect(result.changes.superseded).toEqual([{ billNo: "1278", supersededBy: "1279" }]);
    expect(salesRecords).toHaveLength(2);
    const stale = salesRecords.find((r) => r.externalRef.startsWith("1278|"));
    expect(stale.cancelledAt).toBeInstanceOf(Date);
    expect(salesRecords.find((r) => r.externalRef.startsWith("1279|")).cancelledAt ?? null).toBeNull();

    const again = await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1279)]), "c1");
    expect(again).toMatchObject({ rowsSuperseded: 0, rowsMissingFromSheet: 0 });
  });

  it("a genuinely missing record stays report-only", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    await syncFmsOrderHistory(prisma as any, makeFakeClient([order(1655)]), "c1");
    const result = await syncFmsOrderHistory(prisma as any, makeFakeClient([]), "c1");
    expect(result).toMatchObject({ rowsMissingFromSheet: 1, rowsSuperseded: 0 });
    expect(salesRecords[0].cancelledAt ?? null).toBeNull();
  });
});

describe("syncFmsOrderHistory — negative adjustment rows", () => {
  const bill = (overrides: Record<string, unknown> = {}) =>
    fmsResponseRow({ "Bill No.": 1067, "टाइमस्टैम्प": "2026-06-09 12:29:34", "Customer Name": "Asha Traders", "Bill Amount": 50315, ...overrides });
  const adjustment = (amount: number, overrides: Record<string, unknown> = {}) =>
    ({ "टाइमस्टैम्प": "2026-06-16 00:00:00", "Bill No.": 1067, "Customer Name": "", "Product & Qty": "", "Bill Amount": amount, "Order Taken": "", "Dispatched By": "", "Dispatched Date": "", "PDC Cheque": "", ...overrides }) as unknown as FmsRawRow;
  const run = (deps: ReturnType<typeof makeFakeDeps>, rows: FmsRawRow[], options: Record<string, unknown> = { applyAdjustments: true }) =>
    syncFmsOrderHistory(deps.prisma as any, makeFakeClient(rows), "c1", options);

  it("nets a full reversal to zero on the existing record, keeping the original amount and the adjustment in metadata", async () => {
    const deps = makeFakeDeps();
    await run(deps, [bill()]);

    const result = await run(deps, [bill(), adjustment(-50315)]);

    expect(result).toMatchObject({ rowsAdjustment: 1, rowsAdjustmentUnapplied: 0, rowsFailed: 0, rowsSynced: 0, rowsUpdated: 1 });
    expect(result.changes.adjusted).toEqual([{ billNo: "1067", originalAmount: "50315.00", adjustmentTotal: "-50315.00", netAmount: "0.00", adjustmentRows: 1 }]);
    expect(deps.salesRecords).toHaveLength(1);
    expect(deps.salesRecords[0].orderValue).toBe("0.00");
    expect(deps.salesRecords[0].metadata.fms).toMatchObject({ billAmount: "50315", netAmount: "0.00", adjustments: [{ timestamp: "2026-06-16 00:00:00", amount: "-50315.00" }] });
    expect(deps.salesRecords[0].cancelledAt ?? null).toBeNull();
  });

  it("nets a partial reversal when the adjustment names the same customer written differently (4112 - 3422 = 690)", async () => {
    const deps = makeFakeDeps();
    const original = bill({ "Bill No.": 2330, "टाइमस्टैम्प": "2026-08-20 16:04:22", "Customer Name": "S.K. Hardwares", "Bill Amount": 4112 });
    const result = await run(deps, [original, adjustment(-3422, { "Bill No.": 2330, "टाइमस्टैम्प": "2026-08-20 00:00:00", "Customer Name": "SK Hardwares" })]);

    expect(result).toMatchObject({ rowsSynced: 1, rowsAdjustment: 1, rowsAdjustmentUnapplied: 0, rowsFailed: 0 });
    expect(deps.salesRecords).toHaveLength(1);
    expect(deps.salesRecords[0].orderValue).toBe("690.00");
  });

  it("is idempotent, and removing the adjustment row from the sheet restores the full amount", async () => {
    const deps = makeFakeDeps();
    await run(deps, [bill(), adjustment(-50315)]);
    const again = await run(deps, [bill(), adjustment(-50315)]);
    expect(again).toMatchObject({ rowsUpdated: 0, rowsSkippedDuplicate: 1 });

    const removed = await run(deps, [bill()]);
    expect(removed).toMatchObject({ rowsUpdated: 1 });
    expect(deps.salesRecords[0].orderValue).toBe("50315.00");
    expect(deps.salesRecords[0].metadata.fms.adjustments).toBeUndefined();
  });

  it("never applies an adjustment it cannot tie to exactly one bill of the same customer", async () => {
    const orphan = await run(makeFakeDeps(), [adjustment(-100, { "Bill No.": 9999 })]);
    expect(orphan).toMatchObject({ rowsAdjustmentUnapplied: 1, rowsSynced: 0 });
    expect(orphan.errors[0]).toContain("no original bill");

    const twoOriginals = await run(makeFakeDeps(), [bill(), bill({ "टाइमस्टैम्प": "2026-06-10 10:00:00", "Product & Qty": "other" }), adjustment(-100)]);
    expect(twoOriginals.rowsAdjustmentUnapplied).toBe(1);
    expect(twoOriginals.errors.some((e) => e.includes("2 original rows"))).toBe(true);

    const otherCustomer = makeFakeDeps();
    const r = await run(otherCustomer, [bill(), adjustment(-100, { "Customer Name": "Someone Else" })]);
    expect(r.rowsAdjustmentUnapplied).toBe(1);
    expect(otherCustomer.salesRecords[0].orderValue).toBe("50315.00");
  });

  it("refuses adjustments larger than the bill (no negative sales)", async () => {
    const deps = makeFakeDeps();
    const r = await run(deps, [bill(), adjustment(-60000)]);
    expect(r.rowsAdjustmentUnapplied).toBe(1);
    expect(deps.salesRecords[0].orderValue).toBe("50315.00");
  });

  it("keeps renumbering working: an adjusted bill whose Bill No. is corrected moves with its adjustment", async () => {
    const deps = makeFakeDeps();
    await run(deps, [bill(), adjustment(-315)]);
    const result = await run(deps, [bill({ "Bill No.": 1068 }), adjustment(-315, { "Bill No.": 1068 })]);
    expect(result).toMatchObject({ rowsRenumbered: 1, rowsSynced: 0 });
    expect(deps.salesRecords).toHaveLength(1);
    expect(deps.salesRecords[0]).toMatchObject({ externalRef: "1068|2026-06-09 12:29:34", orderValue: "50000.00" });
  });

  it("with the setting off, negative rows stay invalid exactly as before", async () => {
    const deps = makeFakeDeps();
    const r = await run(deps, [bill(), adjustment(-50315)], {});
    expect(r).toMatchObject({ rowsAdjustment: 0, rowsFailed: 1 });
    expect(deps.salesRecords[0].orderValue).toBe("50315.00");
  });
});
