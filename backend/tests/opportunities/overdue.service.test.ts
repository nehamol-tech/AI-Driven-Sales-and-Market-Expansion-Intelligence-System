import { describe, it, expect, vi } from "vitest";
import type { FmsRawRow } from "@ai-sales/shared";
import type { FetchFmsDataParams, FetchFmsDataResult, FmsClient } from "../../src/modules/fms/fms.client.js";
import {
  ageBucketOf,
  buildCustomerCodeIndex,
  daysOverdue,
  getOverdueAccounts,
  getOverdueBillDetail,
  getOverdueCustomerBills,
  parseAccountProcessRows,
  todayInIndia,
} from "../../src/modules/opportunities/overdue.service.js";

/* -------------------------------------------------------------------------
 * Fixtures mirror the real "Account_Process" / "Customer_Database" headers;
 * values are synthetic. As of 2026-10-27 (India).
 * ---------------------------------------------------------------------- */

const NOW = new Date("2026-10-27T06:00:00Z");

function bill(billNo: number, customer: string, status: "Paid" | "Pending" | "Overdue", balance: number, due: string, date = `2026-04-0${billNo % 9 || 1} 10:00:00`): FmsRawRow {
  return {
    Date: date,
    "Bill No.": billNo,
    "Customer Name": customer,
    "Bill Amount": balance + 1000,
    "Due Days": 30,
    "Days O/S": `${due} 10:00:00`,
    "Payment Received": 1000,
    "Balance Due": balance,
    "Total Payment": 0,
    "Last Follow-up Date": "---",
    "Last Follow-up Stage": "",
    "Follow-up Mode": "",
    "Customer Caption": "",
    "Final Status": status,
    "Date Recd": "---",
  } as unknown as FmsRawRow;
}

const SHEET: FmsRawRow[] = [
  bill(1, "Alpha Stores", "Overdue", 50000, "2026-10-20"), // 7 days
  bill(2, "Alpha Stores", "Overdue", 20000, "2026-07-01"), // 118 days
  bill(3, "Alpha Stores", "Pending", 5000, "2026-11-05"), // outstanding, not overdue
  bill(4, "Beta Traders", "Overdue", 90000, "2026-09-12"), // 45 days
  bill(5, "Beta Traders", "Paid", 0, "2026-05-01"),
  bill(6, "Gamma Mills", "Paid", 0, "2026-05-01"), // never overdue → excluded
  bill(7, "Delta Co", "Overdue", 10000, "2026-08-10"), // 78 days
  bill(8, "Ghost Customer", "Overdue", 7000, "2026-09-01"), // no synced order → unlinked
];

const CODES: FmsRawRow[] = [
  { "Customer Name": "Alpha Stores", "Credit Days": 30, "Code number": "AD1" } as unknown as FmsRawRow,
  { "Customer Name": "beta traders ", "Credit Days": 30, "Code number": "AD2" } as unknown as FmsRawRow,
  { "Customer Name": "Delta Co", "Credit Days": 30, "Code number": "AD3" } as unknown as FmsRawRow,
  { "Customer Name": "Delta Co", "Credit Days": 30, "Code number": "AD9" } as unknown as FmsRawRow, // conflicting → no code
];

function fakeClient(sheet: FmsRawRow[] = SHEET, codes: FmsRawRow[] | null = CODES): FmsClient {
  return {
    fetchData: vi.fn(async (p: FetchFmsDataParams): Promise<FetchFmsDataResult> => {
      const data = p.sheet === "Customer_Database" ? codes : sheet;
      if (data === null) return { status: "network_error", message: "down" };
      return { status: "ok", fetchedAt: "2026-10-27T05:00:00.000Z", body: { success: true, sheet: p.sheet!, count: data.length, totalRows: data.length, data } };
    }),
  };
}

const ACCOUNT_OF: Record<number, string> = { 1: "acc_a", 2: "acc_a", 3: "acc_a", 4: "acc_b", 5: "acc_b", 6: "acc_g", 7: "acc_d" };
function fakePrisma() {
  const records = Object.entries(ACCOUNT_OF).map(([billNo, accountId]) => ({
    id: `sr${billNo}`,
    accountId,
    metadata: { fms: { billNo, timestamp: "x", orderTaken: accountId === "acc_a" ? "Aditya" : "" } },
  }));
  const names: Record<string, string> = { acc_a: "Alpha Stores", acc_b: "Beta Traders", acc_d: "Delta Co", acc_g: "Gamma Mills" };
  return {
    salesRecord: { findMany: vi.fn(async () => records) },
    account: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, name: names[id] }))) },
  } as never;
}

const signals = new Map([["acc_a", [{ type: "AT_RISK" as const, priority: "HIGH" as const }]]]);
const run = (params: Partial<Parameters<typeof getOverdueAccounts>[4]> = {}, client = fakeClient()) =>
  getOverdueAccounts(fakePrisma(), client, "c1", signals, { page: 1, pageSize: 25, sort: "amount", ...params }, NOW);

describe("helpers", () => {
  it("computes today in India time and calendar days overdue", () => {
    expect(todayInIndia(new Date("2026-10-26T20:00:00Z"))).toBe("2026-10-27"); // already the 27th in India
    expect(daysOverdue("2026-10-20 23:59:59", "2026-10-27")).toBe(7);
    expect(daysOverdue("2026-07-01 00:00:00", "2026-10-27")).toBe(118);
    expect(daysOverdue("01/07/2026", "2026-10-27")).toBeNull();
  });

  it("buckets days overdue into 1–30 / 31–60 / 61–90 / 90+", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91, null].map(ageBucketOf)).toEqual([null, "1-30", "1-30", "31-60", "31-60", "61-90", "61-90", "90+", null]);
  });

  it("rejects a sheet missing a required column", () => {
    const broken = SHEET.map(({ ["Final Status"]: _omit, ...rest }) => rest as FmsRawRow);
    const r = parseAccountProcessRows(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(['Required column "Final Status" not found in the "Account_Process" sheet.']);
  });

  it("maps customer codes by exact case-insensitive name, never guessing between conflicting codes", () => {
    const idx = buildCustomerCodeIndex(CODES);
    expect(idx.get("alpha stores")).toBe("AD1");
    expect(idx.get("beta traders")).toBe("AD2");
    expect(idx.get("delta co")).toBeNull();
  });
});

describe("getOverdueAccounts", () => {
  it("lists exactly the accounts holding a sheet-marked Overdue bill, with correct amounts", async () => {
    const r = await run();
    if (r.status !== "ok") throw new Error(r.status);
    const { dto } = r;
    expect(dto.data.map((a) => a.accountName)).toEqual(["Beta Traders", "Alpha Stores", "Delta Co"]); // highest overdue first
    expect(dto.summary).toEqual({ accounts: 3, totalOverdueAmount: "170000.00", averageOverdueAmount: "56666.67", highestOverdueAmount: "90000.00" });
    expect(dto.unlinked).toEqual({ bills: 1, amount: "7000.00" });
    expect(dto.asOfDate).toBe("2026-10-27");
    expect(dto.fetchedAt).toBe("2026-10-27T05:00:00.000Z");

    const alpha = dto.data.find((a) => a.accountId === "acc_a")!;
    expect(alpha).toMatchObject({ overdueAmount: "70000.00", totalOutstanding: "75000.00", daysOverdue: 118, customerCode: "AD1", orderTakenBy: ["Aditya"] });
    expect(alpha.overdueBills.map((b) => [b.billNo, b.daysOverdue])).toEqual([["2", 118], ["1", 7]]);
    expect(alpha.opportunities).toEqual([{ type: "AT_RISK", priority: "HIGH" }]);
    expect(dto.data.find((a) => a.accountId === "acc_d")!.customerCode).toBeNull();
  });

  it("never includes an account whose bills are only Paid or Pending", async () => {
    const r = await run();
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.dto.data.some((a) => a.accountId === "acc_g")).toBe(false);
    expect(r.dto.data.every((a) => Number(a.overdueAmount) > 0)).toBe(true);
  });

  it("filters by the oldest bill's age bucket, keeping the summary for all overdue accounts", async () => {
    const pick = async (age: "1-30" | "31-60" | "61-90" | "90+") => {
      const r = await run({ age });
      if (r.status !== "ok") throw new Error(r.status);
      return { names: r.dto.data.map((a) => a.accountName), total: r.dto.pagination.total, summaryAccounts: r.dto.summary.accounts };
    };
    expect(await pick("90+")).toEqual({ names: ["Alpha Stores"], total: 1, summaryAccounts: 3 });
    expect((await pick("61-90")).names).toEqual(["Delta Co"]);
    expect((await pick("31-60")).names).toEqual(["Beta Traders"]);
    expect((await pick("1-30")).names).toEqual([]);
  });

  it("sorts by amount, oldest, most recent and name", async () => {
    const order = async (sort: "amount" | "oldest" | "recent" | "name") => {
      const r = await run({ sort });
      if (r.status !== "ok") throw new Error(r.status);
      return r.dto.data.map((a) => a.accountName);
    };
    expect(await order("amount")).toEqual(["Beta Traders", "Alpha Stores", "Delta Co"]);
    expect(await order("oldest")).toEqual(["Alpha Stores", "Delta Co", "Beta Traders"]);
    expect(await order("recent")).toEqual(["Beta Traders", "Delta Co", "Alpha Stores"]);
    expect(await order("name")).toEqual(["Alpha Stores", "Beta Traders", "Delta Co"]);
  });

  it("searches by account name, customer code, or exact bill number", async () => {
    const find = async (search: string) => {
      const r = await run({ search });
      if (r.status !== "ok") throw new Error(r.status);
      return r.dto.data.map((a) => a.accountName);
    };
    expect(await find("beta")).toEqual(["Beta Traders"]);
    expect(await find("ad1")).toEqual(["Alpha Stores"]);
    expect(await find("7")).toEqual(["Delta Co"]);
    expect(await find("zzz")).toEqual([]);
  });

  it("pages server-side", async () => {
    const r = await run({ pageSize: 2, page: 2 });
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.dto.data.map((a) => a.accountName)).toEqual(["Delta Co"]);
    expect(r.dto.pagination).toEqual({ page: 2, pageSize: 2, total: 3 });
  });

  it("returns an empty list (not an error) when nothing is overdue", async () => {
    const r = await run({}, fakeClient(SHEET.filter((b) => b["Final Status"] !== "Overdue")));
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.dto.data).toEqual([]);
    expect(r.dto.summary).toEqual({ accounts: 0, totalOverdueAmount: "0.00", averageOverdueAmount: "0.00", highestOverdueAmount: "0.00" });
  });

  it("still works without customer codes, and says so", async () => {
    const r = await run({}, fakeClient(SHEET, null));
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.dto.data.every((a) => a.customerCode === null)).toBe(true);
    expect(r.dto.retrieval.reason).toMatch(/Customer codes are unavailable/);
  });

  it("maps Apps Script failures to upstream_error and bad layouts to layout_invalid", async () => {
    const down: FmsClient = { fetchData: async () => ({ status: "network_error", message: "HTTP 500" }) };
    expect(await run({}, down)).toEqual({ status: "upstream_error", message: "HTTP 500" });
    const bad = fakeClient([{ Foo: "x" } as unknown as FmsRawRow]);
    expect((await run({}, bad)).status).toBe("layout_invalid");
  });
});

describe("overdue bills per customer and bill details", () => {
  it("adds each bill's paid amount (Payment Received) and sheet customer name without changing any amount", async () => {
    const r = await run();
    if (r.status !== "ok") throw new Error(r.status);
    const alpha = r.dto.data.find((a) => a.accountId === "acc_a")!;
    expect(alpha.overdueBills.map((b) => [b.billNo, b.billAmount, b.paidAmount, b.balanceDue, b.customerName])).toEqual([
      ["2", "21000.00", "1000.00", "20000.00", "Alpha Stores"],
      ["1", "51000.00", "1000.00", "50000.00", "Alpha Stores"],
    ]);
    expect(alpha).toMatchObject({ overdueAmount: "70000.00", totalOutstanding: "75000.00" });
  });

  it("returns one customer's overdue bills (oldest first) with the same totals as the list, paged", async () => {
    const r = await getOverdueCustomerBills(fakePrisma(), fakeClient(), "c1", "acc_a", { page: 1, pageSize: 25 }, NOW);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.dto.account).toEqual({ accountId: "acc_a", accountName: "Alpha Stores", customerCode: "AD1" });
    expect(r.dto.summary).toEqual({ overdueBills: 2, overdueAmount: "70000.00", totalOutstanding: "75000.00" });
    expect(r.dto.data.map((b) => [b.billNo, b.daysOverdue])).toEqual([["2", 118], ["1", 7]]);
    expect(r.dto.pagination).toEqual({ page: 1, pageSize: 25, total: 2 });

    const page2 = await getOverdueCustomerBills(fakePrisma(), fakeClient(), "c1", "acc_a", { page: 2, pageSize: 1 }, NOW);
    if (page2.status !== "ok") throw new Error(page2.status);
    expect(page2.dto.data.map((b) => b.billNo)).toEqual(["1"]);
  });

  it("is not_found for an account with no overdue bills or an unknown account", async () => {
    expect((await getOverdueCustomerBills(fakePrisma(), fakeClient(), "c1", "acc_g", { page: 1, pageSize: 25 }, NOW)).status).toBe("not_found");
    expect((await getOverdueCustomerBills(fakePrisma(), fakeClient(), "c1", "nope", { page: 1, pageSize: 25 }, NOW)).status).toBe("not_found");
  });

  it("returns a bill's payment-sheet row with its linked account and synced order", async () => {
    const prisma = fakePrisma() as unknown as { salesRecord: { findMany: unknown } };
    prisma.salesRecord.findMany = vi.fn(async (args: { where: { id?: unknown } }) =>
      args.where.id
        ? [{ id: "sr2", orderValue: "21000", cancelledAt: null, metadata: { fms: { timestamp: "t2", productAndQty: "R (3.15) - 2 Box", orderTaken: "Aditya", dispatchedBy: "Ram", dispatchedDate: "2026-04-02 00:00:00" } }, account: { id: "acc_a", name: "Alpha Stores" } }]
        : Object.entries(ACCOUNT_OF).map(([billNo, accountId]) => ({ id: `sr${billNo}`, accountId, metadata: { fms: { billNo, timestamp: "x", orderTaken: "" } } })),
    );
    const r = await getOverdueBillDetail(prisma as never, fakeClient(), "c1", "2", NOW);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.dto.billNo).toBe("2");
    expect(r.dto.entries).toHaveLength(1);
    expect(r.dto.entries[0]).toMatchObject({
      billNo: "2",
      customerName: "Alpha Stores",
      billAmount: "21000.00",
      paidAmount: "1000.00",
      balanceDue: "20000.00",
      finalStatus: "Overdue",
      daysOverdue: 118,
      dueDays: "30",
      account: { accountId: "acc_a", accountName: "Alpha Stores" },
      order: { productAndQty: "R (3.15) - 2 Box", orderTaken: "Aditya", dispatchedBy: "Ram", orderValue: "21000.00", cancelled: false },
    });
  });

  it("is not_found for a Bill No. that isn't in the payment sheet", async () => {
    expect((await getOverdueBillDetail(fakePrisma(), fakeClient(), "c1", "999999", NOW)).status).toBe("not_found");
  });
});

