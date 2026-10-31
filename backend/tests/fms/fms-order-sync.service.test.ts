/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { syncFmsOrders } from "../../src/modules/fms/fms-order-sync.service.js";
import type { FetchFmsDataResult, FmsClient, FmsApiSuccessBody } from "../../src/modules/fms/fms.client.js";
import type { FmsRawRow } from "@ai-sales/shared";

function makeFakeClient(rows: FmsRawRow[]): FmsClient {
  const body: FmsApiSuccessBody = { success: true, sheet: "Form responses 2", count: rows.length, totalRows: rows.length, data: rows };
  const result: FetchFmsDataResult = { status: "ok", body };
  return { fetchData: vi.fn(async () => result) };
}

/**
 * In-memory fake Prisma-like store for Account/SalesRecord — mirrors
 * advertising/ad-sync.service.test.ts's makeFakeDeps. `salesRecord.create`
 * simulates the real database's `@@unique([companyId, source,
 * externalRef])` constraint by throwing a genuine
 * Prisma.PrismaClientKnownRequestError(code: "P2002") on a colliding
 * triple — the same class/code the real Postgres driver would surface —
 * so the service's race-condition handling path is exercised for real,
 * not just assumed.
 */
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
      findUnique: vi.fn(async (args: any) => {
        const { companyId, source, externalRef } = args.where.companyId_source_externalRef;
        return salesRecords.find((r) => r.companyId === companyId && r.source === source && r.externalRef === externalRef) ?? null;
      }),
      create: vi.fn(async (args: any) => {
        const { companyId, source, externalRef } = args.data;
        const collision = salesRecords.find((r) => r.companyId === companyId && r.source === source && r.externalRef === externalRef);
        if (collision) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`companyId`,`source`,`externalRef`)", {
            code: "P2002",
            clientVersion: "5.22.0",
          });
        }
        const row = { id: `sr_${nextRecordId++}`, ...args.data };
        salesRecords.push(row);
        return row;
      }),
    },
  };

  return { prisma, accounts, salesRecords };
}

function fixtureRow(overrides: Partial<Record<string, unknown>> = {}): FmsRawRow {
  return {
    "टाइमस्टैम्प": "2026-04-01 11:38:21",
    "Bill No.": 1,
    "Customer Name": "Krishna Mill Stores",
    "Product and Qty": "R (3.15) - 21 Box\nC (0.80) - 11\nC (1.20) - 11",
    "Order Taken": "Aditya",
    "Dispatched By": "Ram",
    "Dispatched Date": "2026-04-01 00:00:00",
    "PDC Cheque Date": "",
    "Bill Amount": 95391,
    ...overrides,
  } as unknown as FmsRawRow;
}

describe("syncFmsOrders", () => {
  it("1. syncs a valid FMS order as one SalesRecord tagged FMS_SYNC", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([fixtureRow()]);

    const result = await syncFmsOrders(prisma as any, client, "c1");

    expect(result).toMatchObject({ rowsFetched: 1, rowsSynced: 1, rowsSkippedDuplicate: 0, rowsFailed: 0, errors: [] });
    expect(salesRecords).toHaveLength(1);
    expect(salesRecords[0].source).toBe("FMS_SYNC");
    expect(salesRecords[0].companyId).toBe("c1");
  });

  it("1. metadata is stored correctly on the created SalesRecord", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([fixtureRow()]);

    await syncFmsOrders(prisma as any, client, "c1");

    expect(salesRecords[0].metadata).toEqual({
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
    });
    expect(salesRecords[0].externalRef).toBe("1|2026-04-01 11:38:21");
  });

  it("resolves the same customer to the same Account across rows, creating it only once", async () => {
    const { prisma, accounts } = makeFakeDeps();
    const client = makeFakeClient([
      fixtureRow({ "Bill No.": 1, "Bill Amount": 100 }),
      fixtureRow({ "Bill No.": 2, "Bill Amount": 200 }),
    ]);

    const result = await syncFmsOrders(prisma as any, client, "c1");

    expect(accounts).toHaveLength(1);
    expect(result.accountsCreated).toBe(1);
    expect(result.accountsResolved).toBe(0);
    expect(result.rowsSynced).toBe(2);
  });

  it("resolves (not re-creates) an Account that already existed before this sync ran", async () => {
    const { prisma, accounts } = makeFakeDeps();
    accounts.push({ id: "acc_existing", companyId: "c1", name: "Krishna Mill Stores", normalizedName: "krishna mill stores" });
    const client = makeFakeClient([fixtureRow()]);

    const result = await syncFmsOrders(prisma as any, client, "c1");

    expect(accounts).toHaveLength(1);
    expect(result.accountsCreated).toBe(0);
    expect(result.accountsResolved).toBe(1);
  });

  it("stores Bill Amount as the whole order's orderValue, unmodified", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([fixtureRow({ "Bill Amount": 95391 })]);

    await syncFmsOrders(prisma as any, client, "c1");

    expect(salesRecords[0].orderValue).toBe("95391.00");
  });

  it("9. running the sync twice against identical data creates zero new SalesRecords the second time", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const rows = [fixtureRow({ "Bill No.": 1, "Bill Amount": 95391 }), fixtureRow({ "Bill No.": 2, "Customer Name": "Amar Trading Company", "Bill Amount": 46728 })];

    const first = await syncFmsOrders(prisma as any, makeFakeClient(rows), "c1");
    expect(first.rowsSynced).toBe(2);
    expect(salesRecords).toHaveLength(2);

    const second = await syncFmsOrders(prisma as any, makeFakeClient(rows), "c1");
    expect(second.rowsSynced).toBe(0);
    expect(second.rowsSkippedDuplicate).toBe(2);
    expect(salesRecords).toHaveLength(2); // still just 2 — no duplicates
  });

  it("9b. a concurrent-style collision at create() time (DB unique constraint) is treated as a duplicate, not a failure", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    // Pre-seed a row with the externalRef a new sync would also produce —
    // simulates another process having inserted it between this sync's
    // findUnique check and its create() call.
    salesRecords.push({ id: "sr_preexisting", companyId: "c1", source: "FMS_SYNC", externalRef: "1|2026-04-01 11:38:21" });
    // Bypass findUnique "seeing" it by making the fake's findUnique miss (simulating the race window) while create() still enforces the constraint:
    (prisma.salesRecord.findUnique as any).mockResolvedValueOnce(null);

    const result = await syncFmsOrders(prisma as any, makeFakeClient([fixtureRow()]), "c1");

    expect(result.rowsSkippedDuplicate).toBe(1);
    expect(result.rowsFailed).toBe(0);
    expect(salesRecords).toHaveLength(1); // the pre-seeded row only — no second row created
  });

  it("11. two orders sharing the same customer/date/amount but a different Bill No. remain two separate SalesRecords", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([
      fixtureRow({ "Bill No.": 1, "टाइमस्टैम्प": "2026-04-01 11:38:21" }),
      fixtureRow({ "Bill No.": 2, "टाइमस्टैम्प": "2026-04-01 12:00:00" }), // same customer/date/amount as row 1, different identity
    ]);

    const result = await syncFmsOrders(prisma as any, client, "c1");

    expect(result.rowsSynced).toBe(2);
    expect(result.rowsSkippedDuplicate).toBe(0);
    expect(salesRecords).toHaveLength(2);
    expect(salesRecords[0].externalRef).not.toBe(salesRecords[1].externalRef);
  });

  it("re-syncing the same order after its Bill Amount changed upstream is still recognized as the same order (identity is independent of amount)", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    await syncFmsOrders(prisma as any, makeFakeClient([fixtureRow({ "Bill Amount": 95391 })]), "c1");
    expect(salesRecords).toHaveLength(1);

    // Same Bill No. + timestamp, but the source's Bill Amount is now different.
    const result = await syncFmsOrders(prisma as any, makeFakeClient([fixtureRow({ "Bill Amount": 999999 })]), "c1");

    expect(result.rowsSkippedDuplicate).toBe(1);
    expect(result.rowsSynced).toBe(0);
    expect(salesRecords).toHaveLength(1); // still just the original — no second row, original amount untouched
    expect(salesRecords[0].orderValue).toBe("95391.00");
  });

  it("re-syncing the same order after its Dispatched Date changed upstream is still recognized as the same order (identity is independent of date)", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    await syncFmsOrders(prisma as any, makeFakeClient([fixtureRow({ "Dispatched Date": "2026-04-01 00:00:00" })]), "c1");
    expect(salesRecords).toHaveLength(1);

    const result = await syncFmsOrders(prisma as any, makeFakeClient([fixtureRow({ "Dispatched Date": "2026-04-05 00:00:00" })]), "c1");

    expect(result.rowsSkippedDuplicate).toBe(1);
    expect(salesRecords).toHaveLength(1);
  });

  it("a row missing a required field is skipped with a traceable error, without aborting the rest of the batch", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([
      fixtureRow({ "Bill No.": 1, "Customer Name": "" }), // invalid: missing customer name
      fixtureRow({ "Bill No.": 2, "Customer Name": "Amar Trading Company", "Bill Amount": 46728 }), // valid
    ]);

    const result = await syncFmsOrders(prisma as any, client, "c1");

    expect(result.rowsFailed).toBe(1);
    expect(result.rowsSynced).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Bill No. 1");
    expect(salesRecords).toHaveLength(1);
  });

  it("a row with multiple Product and Qty lines still produces exactly one SalesRecord", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([
      fixtureRow({ "Product and Qty": "R (2.50) - 5 Box\nR (3.15) - 21 Box\nR (4.00) - 5 Box\nRO Primers (4L) - 10 Tin\nRO Primers (20L) - 2 Tin" }),
    ]);

    await syncFmsOrders(prisma as any, client, "c1");

    expect(salesRecords).toHaveLength(1);
  });

  it("Product and Qty is preserved verbatim in metadata but never interpreted — no productId, no computed field derived from it", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const raw = "C (0.80) (12.5) NW70 - 5";
    const client = makeFakeClient([fixtureRow({ "Product and Qty": raw })]);

    await syncFmsOrders(prisma as any, client, "c1");

    const created = salesRecords[0];
    expect(created.productId).toBeUndefined();
    expect(created.metadata.fms.productAndQty).toBe(raw); // preserved, verbatim
    expect(created.quantity).toBe(1); // documented placeholder, not derived from "NW70 - 5"
  });

  it("no product-level revenue is fabricated — the full Bill Amount lands on the single order record even with many product lines", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const client = makeFakeClient([
      fixtureRow({
        "Product and Qty": "R (2.50) - 6 Box\nR (3.15) - 21 Box\nR (4.00) - 4 Box\nC (0.80) - 10\nC (1.20) - 5",
        "Bill Amount": 120791,
      }),
    ]);

    await syncFmsOrders(prisma as any, client, "c1");

    expect(salesRecords).toHaveLength(1);
    expect(salesRecords[0].orderValue).toBe("120791.00");
  });

  it("12. never reads or writes any record belonging to another source (MANUAL/CSV_IMPORT untouched)", async () => {
    const { prisma, salesRecords } = makeFakeDeps();
    const manualRecord = { id: "sr_manual", companyId: "c1", source: "MANUAL", customerName: "Existing Manual Customer", orderValue: "500.00" };
    salesRecords.push(manualRecord);

    await syncFmsOrders(prisma as any, makeFakeClient([fixtureRow()]), "c1");

    const stillThere = salesRecords.find((r) => r.id === "sr_manual");
    expect(stillThere).toEqual(manualRecord); // byte-for-byte unchanged
    expect(salesRecords).toHaveLength(2); // the untouched MANUAL row + the one new FMS_SYNC row
  });
});
