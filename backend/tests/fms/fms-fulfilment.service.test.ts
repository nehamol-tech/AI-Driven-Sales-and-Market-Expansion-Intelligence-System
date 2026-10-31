import { describe, it, expect, vi } from "vitest";
import type { FmsRawRow } from "@ai-sales/shared";
import type { FetchFmsDataResult, FmsClient } from "../../src/modules/fms/fms.client.js";
import {
  FULFILMENT_FETCH_LIMIT,
  assessRetrieval,
  detectFulfilmentLayout,
  getOrderFulfilment,
  matchSalesRecord,
  parseFulfilmentRows,
} from "../../src/modules/fms/fms-fulfilment.service.js";

/* -------------------------------------------------------------------------
 * Fixture mirroring the real "FMS" sheet's layout: the Apps Script keys rows
 * by the sheet's FIRST row (junk keys), then a step-marker row, the
 * What/Who/How/When block, and the real header row at index 5. Only the
 * structure is real — every value here is synthetic.
 * ---------------------------------------------------------------------- */

const KEYS = [
  "Column_1", "Sat Dec 30 1899 09:30:00 GMT+0521", "Sat Dec 30 1899 10:00:00 GMT+0521", "Sat Dec 30 1899 19:30:00 GMT+0521",
  "0000001", "Column_6", "Column_7", "Column_8", "Column_9",
  "Step1", "Column_11", "Column_12", "Column_13", "Column_14",
  "Step2", "Column_16", "Column_17", "Column_18",
  "Step3", "Column_20", "Column_21", "Column_22",
  "Step4", "Column_24", "Column_25", "Column_26",
  "Column_27", "Column_28", "Column_29", "Column_30", "Column_31",
];

const HEADERS = [
  "Timestamp", "Bill No.", "Customer Name", "Product & Qty", "Bill Amount", "Order Taken", "Dispatched By", "Dispatched Date", "PDC Cheque",
  "Lead Time", "Planned", "Actual", "Status", "Time Delay",
  "Planned", "Actual", "Status", "Time Delay",
  "Planned", "Actual", "Status", "Time Delay",
  "Planned", "Actual", "Status", "Time Delay",
  "Planned", "Actual", "Status", "Time", "PDC Cheque",
];

function row(cells: Record<number, unknown>): FmsRawRow {
  return Object.fromEntries(KEYS.map((k, i) => [k, cells[i] ?? ""])) as FmsRawRow;
}

const STEP_NAMES = ["Billing and Rechecking", "Material Shuffling/Loading", "Material Dispatch", "Customer Received", "Accounts Process"];
const ACTUAL_COLS = [11, 15, 19, 23, 27];

function preamble(headers: string[] = HEADERS): FmsRawRow[] {
  return [
    row(Object.fromEntries(ACTUAL_COLS.map((c, i) => [c, `step${i + 1}`]))),
    row({ 0: "What", 1: "Order Taking", 9: STEP_NAMES[0], 14: STEP_NAMES[1], 18: STEP_NAMES[2], 22: STEP_NAMES[3], 26: STEP_NAMES[4] }),
    row({ 0: "Who" }),
    row({ 0: "How" }),
    row({ 0: "When" }),
    row(Object.fromEntries(headers.map((h, i) => [i, h]))),
  ];
}

/** An order row: steps 1–2 done, step 3 actual later than planned, steps 4–5 pending. */
function orderRow(billNo: unknown, timestamp: string, extra: Record<number, unknown> = {}): FmsRawRow {
  return row({
    0: timestamp, 1: billNo, 2: "Test Customer", 3: "X (1.00) - 2", 4: 1000, 5: "A", 6: "B", 7: "2026-04-02 00:00:00",
    10: "2026-04-01 10:00:00", 11: "2026-04-01 09:00:00", 12: "Done",
    14: "2026-04-01 12:00:00", 15: "2026-04-01 11:00:00", 16: "Done", 17: "0:00",
    18: "2026-04-01 14:00:00", 19: "2026-04-01 15:30:00",
    22: "2026-04-02 19:00:00",
    26: "2026-04-10 00:00:00",
    ...extra,
  });
}

function fakeClient(rows: FmsRawRow[], totalRows = rows.length): { client: FmsClient; fetchData: ReturnType<typeof vi.fn> } {
  const fetchData = vi.fn(
    async (): Promise<FetchFmsDataResult> => ({ status: "ok", body: { success: true, sheet: "FMS", count: rows.length, totalRows, data: rows } }),
  );
  return { client: { fetchData }, fetchData };
}

function fakePrisma(records: { id: string; accountId: string | null; metadata: unknown }[]) {
  const findMany = vi.fn(async () => records);
  return { prisma: { salesRecord: { findMany } } as never, findMany };
}

describe("detectFulfilmentLayout", () => {
  it("finds the real header row by its Timestamp/Bill No. cells, ignoring the junk JSON keys", () => {
    const result = detectFulfilmentLayout(preamble());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.headerRowIndex).toBe(5);
    expect(result.layout.orderKeys["Bill No."]).toBe("Sat Dec 30 1899 09:30:00 GMT+0521");
    expect(result.layout.steps.map((s) => s.actualKey)).toEqual(ACTUAL_COLS.map((c) => KEYS[c]));
    expect(result.layout.steps.map((s) => s.name)).toEqual(STEP_NAMES);
  });

  it("reads Time Delay only where the header says exactly that, and warns for step 5's \"Time\" column", () => {
    const result = detectFulfilmentLayout(preamble());
    if (!result.ok) throw new Error("expected ok");
    expect(result.layout.steps.slice(0, 4).every((s) => s.timeDelayKey !== null)).toBe(true);
    expect(result.layout.steps[4].timeDelayKey).toBeNull();
    expect(result.layout.warnings).toEqual([expect.stringContaining('Step 5 (Accounts Process): the column after Status is headed "Time"')]);
  });

  it("fails when no header row is present", () => {
    const result = detectFulfilmentLayout([row({ 0: "x" }), row({ 1: "y" })]);
    expect(result).toEqual({ ok: false, problems: [expect.stringContaining("No header row")] });
  });

  it("fails with the missing column named when a required order column is absent", () => {
    const headers = [...HEADERS];
    headers[3] = "Products";
    const result = detectFulfilmentLayout(preamble(headers));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toContain('Required column "Product & Qty" not found in the header row.');
  });

  it("fails when a step's columns are not Planned | Actual | Status around its marker", () => {
    const headers = [...HEADERS];
    headers[16] = "State";
    const result = detectFulfilmentLayout(preamble(headers));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/Step 2 \(Material Shuffling\/Loading\)/);
  });

  it("fails when a step marker is missing", () => {
    const rows = preamble();
    rows[0] = row({ 11: "step1", 15: "step2", 19: "step3", 23: "step4" });
    const result = detectFulfilmentLayout(rows);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/step5/);
  });
});

describe("parseFulfilmentRows", () => {
  const layout = (() => {
    const r = detectFulfilmentLayout(preamble());
    if (!r.ok) throw new Error("fixture layout invalid");
    return r.layout;
  })();

  it("preserves raw values, flags missing/malformed cells, and never treats a later actual as a lateness verdict beyond a plain comparison", () => {
    const rows = [...preamble(), orderRow(101, "2026-04-01 08:00:00", { 23: "#NUM!", 25: "  " })];
    const { orders } = parseFulfilmentRows(rows, layout);
    expect(orders).toHaveLength(1);
    const [s1, s2, s3, s4, s5] = orders[0].steps;

    expect(orders[0].billNo).toBe("101");
    expect(s1).toMatchObject({ planned: "2026-04-01 10:00:00", actual: "2026-04-01 09:00:00", status: "Done", timeDelay: "", actualAfterPlanned: false });
    expect(s2).toMatchObject({ timeDelay: "0:00", issues: [] });
    expect(s3).toMatchObject({ actualAfterPlanned: true });
    expect(s3.issues).toEqual([
      { field: "status", issue: "missing" },
      { field: "timeDelay", issue: "missing" },
    ]);
    expect(s4.actual).toBe("#NUM!");
    expect(s4.issues).toContainEqual({ field: "actual", issue: "sheet_error" });
    expect(s4.actualAfterPlanned).toBeNull();
    expect(s5).toMatchObject({ actual: "", timeDelay: null, actualAfterPlanned: null });
    expect(s5.issues).toContainEqual({ field: "actual", issue: "missing" });
  });

  it("flags non-standard timestamps as unrecognised_format and does not compare them", () => {
    const rows = [...preamble(), orderRow("102", "t", { 19: "01/04/2026 15:30:00" })];
    const step3 = parseFulfilmentRows(rows, layout).orders[0].steps[2];
    expect(step3.issues).toContainEqual({ field: "actual", issue: "unrecognised_format" });
    expect(step3.actualAfterPlanned).toBeNull();
  });

  it("skips blank rows, counts rows without a numeric Bill No. as non-order rows", () => {
    const rows = [...preamble(), orderRow(1, "t1"), row({}), row({ 18: "#NUM!", 26: "#NUM!" }), row({ 1: "Total" }), orderRow(2, "t2")];
    const parsed = parseFulfilmentRows(rows, layout);
    expect(parsed.orders.map((o) => o.billNo)).toEqual(["1", "2"]);
    expect(parsed.nonOrderRows).toBe(2);
    expect(parsed.lastOrderRowIndex).toBe(rows.length - 1);
  });
});

describe("matchSalesRecord", () => {
  const order = { billNo: "7", orderTimestamp: "2026-04-01 10:00:00", customerName: "", steps: [] };

  it("matches a unique Bill No.", () => {
    const index = new Map([["7", [{ id: "sr1", accountId: "a1", timestamp: "other" }]]]);
    expect(matchSalesRecord(order, index)).toEqual({ status: "matched", salesRecordId: "sr1", accountId: "a1", matchedBy: "bill_no" });
  });

  it("uses an exact timestamp to pick between orders sharing a Bill No.", () => {
    const index = new Map([
      ["7", [
        { id: "sr1", accountId: null, timestamp: "2026-03-01 09:00:00" },
        { id: "sr2", accountId: null, timestamp: "2026-04-01 10:00:00" },
      ]],
    ]);
    expect(matchSalesRecord(order, index)).toEqual({ status: "matched", salesRecordId: "sr2", accountId: null, matchedBy: "bill_no_and_timestamp" });
  });

  it("reports ambiguous (no join) when the timestamp does not single one out", () => {
    const index = new Map([
      ["7", [
        { id: "sr1", accountId: null, timestamp: "2026-04-01 10:00:01" },
        { id: "sr2", accountId: null, timestamp: "2026-04-01 10:00:02" },
      ]],
    ]);
    expect(matchSalesRecord(order, index)).toEqual({ status: "ambiguous", candidateCount: 2 });
  });

  it("reports unmatched, never a fuzzy match, when the Bill No. differs", () => {
    const index = new Map([["07", [{ id: "sr1", accountId: null, timestamp: order.orderTimestamp }]]]);
    expect(matchSalesRecord(order, index)).toEqual({ status: "unmatched" });
  });
});

describe("assessRetrieval", () => {
  it("is complete when fewer rows than the limit came back", () => {
    expect(assessRetrieval(2800, 2800, 2799).complete).toBe(true);
  });

  it("is complete at the limit only when a long run of trailing rows holds no orders", () => {
    expect(assessRetrieval(FULFILMENT_FETCH_LIMIT, 50500, 2798)).toMatchObject({ complete: true, totalRowsReported: 50500 });
  });

  it("is incomplete when orders run right up to the cut-off", () => {
    const r = assessRetrieval(FULFILMENT_FETCH_LIMIT, 50500, FULFILMENT_FETCH_LIMIT - 3);
    expect(r.complete).toBe(false);
    expect(r.reason).toMatch(/may be missing/);
  });
});

describe("getOrderFulfilment", () => {
  it("reads the FMS sheet with a GET at the Apps Script's 10,000-row limit and joins only via stored metadata.fms.billNo", async () => {
    const rows = [...preamble(), orderRow(1, "t1"), orderRow(2, "t2"), orderRow(3, "t3")];
    const { client, fetchData } = fakeClient(rows);
    const { prisma, findMany } = fakePrisma([
      { id: "sr1", accountId: "a1", metadata: { fms: { billNo: "1", timestamp: "t1" } } },
      { id: "sr2a", accountId: null, metadata: { fms: { billNo: "2", timestamp: "x" } } },
      { id: "sr2b", accountId: null, metadata: { fms: { billNo: "2", timestamp: "y" } } },
      { id: "manual", accountId: null, metadata: null },
    ]);

    const result = await getOrderFulfilment(prisma, client, "c1", { page: 1, pageSize: 10 });

    expect(fetchData).toHaveBeenCalledWith({ sheet: "FMS", limit: FULFILMENT_FETCH_LIMIT });
    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: "c1", source: "FMS_SYNC" },
      select: { id: true, accountId: true, metadata: true },
    });
    if (result.status !== "ok") throw new Error(result.status);
    const { dto } = result;
    expect(dto.totals).toEqual({ orders: 3, matched: 1, unmatched: 1, ambiguous: 1, nonOrderRows: 0, duplicateBillNos: 0 });
    expect(dto.orders.map((o) => o.billNo)).toEqual(["3", "2", "1"]);
    expect(dto.orders[2].stepsWithActual).toBe(3);
    expect(dto.stepSummary[2]).toMatchObject({ withActual: 3, actualAfterPlanned: 3, withRecordedDelay: 0 });
    expect(dto.stepSummary[1]).toMatchObject({ withRecordedDelay: 3 });
    expect(dto.retrieval.complete).toBe(true);
    expect(dto.headerRowIndex).toBe(5);
  });

  it("pages the order list while totals cover every order", async () => {
    const rows = [...preamble(), ...Array.from({ length: 5 }, (_, i) => orderRow(i + 1, `t${i}`))];
    const { prisma } = fakePrisma([]);
    const result = await getOrderFulfilment(prisma, fakeClient(rows).client, "c1", { page: 2, pageSize: 2 });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.dto).toMatchObject({ page: 2, pageSize: 2, totalPages: 3 });
    expect(result.dto.orders.map((o) => o.billNo)).toEqual(["3", "2"]);
    expect(result.dto.totals.orders).toBe(5);
  });

  it("returns layout_invalid without touching the database when the header row is missing", async () => {
    const { prisma, findMany } = fakePrisma([]);
    const result = await getOrderFulfilment(prisma, fakeClient([row({ 0: "x" })]).client, "c1", { page: 1, pageSize: 10 });
    expect(result.status).toBe("layout_invalid");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("maps client failures to upstream_error", async () => {
    const client: FmsClient = { fetchData: async () => ({ status: "network_error", message: "HTTP 500" }) };
    const result = await getOrderFulfilment(fakePrisma([]).prisma, client, "c1", { page: 1, pageSize: 10 });
    expect(result).toEqual({ status: "upstream_error", message: "HTTP 500" });
  });

  it("reports when the Apps Script actually answered (a cached response's fetchedAt), not the request time", async () => {
    const data = [...preamble(), orderRow(1, "t")];
    const client: FmsClient = {
      fetchData: async () => ({ status: "ok", fetchedAt: "2026-10-27T05:00:00.000Z", body: { success: true, sheet: "FMS", count: data.length, totalRows: data.length, data } }),
    };
    const result = await getOrderFulfilment(fakePrisma([]).prisma, client, "c1", { page: 1, pageSize: 10 });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.dto.fetchedAt).toBe("2026-10-27T05:00:00.000Z");
  });

  it("parses a given cached response only once, however many pages are requested", async () => {
    const rows = preamble();
    let headerReads = 0;
    rows[5] = new Proxy(rows[5], { ownKeys: (t) => (headerReads++, Reflect.ownKeys(t)) });
    const data = [...rows, orderRow(1, "t1"), orderRow(2, "t2")];
    const sameResponse: FetchFmsDataResult = { status: "ok", body: { success: true, sheet: "FMS", count: data.length, totalRows: data.length, data } };
    const client: FmsClient = { fetchData: async () => sameResponse };
    const { prisma } = fakePrisma([]);
    await getOrderFulfilment(prisma, client, "c1", { page: 1, pageSize: 1 });
    const readsAfterFirst = headerReads;
    await getOrderFulfilment(prisma, client, "c1", { page: 2, pageSize: 1 });
    // Only layout detection reads the header row, so a memo hit leaves the count unchanged.
    expect(readsAfterFirst).toBeGreaterThan(0);
    expect(headerReads).toBe(readsAfterFirst);
  });
});
