import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { FetchFmsDataResult, FmsClient } from "../../src/modules/fms/fms.client.js";

/* -------------------------------------------------------------------------
 * HTTP-level test for GET /api/fms/fulfilment. Prisma and the FMS client
 * factory are mocked, so no network or database access happens. The mocked
 * prisma exposes ONLY read methods — any write attempt would throw.
 * ---------------------------------------------------------------------- */

const findUniqueUser = vi.fn();
const findManySalesRecords = vi.fn();
vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    salesRecord: { findMany: (...args: unknown[]) => findManySalesRecords(...args) },
  },
}));

const fetchData = vi.fn<() => Promise<FetchFmsDataResult>>();
let fmsConfigured = true;
vi.mock("../../src/modules/fms/fms-client.factory.js", () => ({
  isFmsConfigured: () => fmsConfigured,
  getFmsClient: (): FmsClient | null => (fmsConfigured ? { fetchData } : null),
  getCachedFmsClient: (): FmsClient | null => (fmsConfigured ? { fetchData } : null),
}));

const { createApp } = await import("../../src/app.js");
const { signSessionToken } = await import("../../src/lib/jwt.js");
const { SESSION_COOKIE_NAME } = await import("../../src/config/constants.js");

const app = createApp();
const cookie = `${SESSION_COOKIE_NAME}=${signSessionToken({ userId: "u1", role: "SALES_USER", companyId: "c1" })}`;

/** Minimal valid layout: markers row, What row, header row, one order. */
function sheetRows() {
  const headers = [
    "Timestamp", "Bill No.", "Customer Name", "Product & Qty", "Bill Amount", "Order Taken", "Dispatched By", "Dispatched Date", "PDC Cheque",
    ...[1, 2, 3, 4, 5].flatMap(() => ["Planned", "Actual", "Status", "Time Delay"]),
  ];
  const keys = headers.map((_, i) => `Column_${i + 1}`);
  const make = (cells: Record<number, string>) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ""]));
  const actualCols = [10, 14, 18, 22, 26];
  const names = ["Billing and Rechecking", "Material Shuffling/Loading", "Material Dispatch", "Customer Received", "Accounts Process"];
  return [
    make(Object.fromEntries(actualCols.map((c, i) => [c, `step${i + 1}`]))),
    make({ 0: "What", ...Object.fromEntries(actualCols.map((c, i) => [c - 1, names[i]])) }),
    make(Object.fromEntries(headers.map((h, i) => [i, h]))),
    make({ 0: "2026-04-01 08:00:00", 1: "42", 2: "Test Customer", 9: "2026-04-01 10:00:00", 10: "2026-04-01 09:00:00", 11: "Done" }),
  ];
}

describe("GET /api/fms/fulfilment", () => {
  beforeEach(() => {
    fmsConfigured = true;
    fetchData.mockReset();
    findManySalesRecords.mockReset();
    findManySalesRecords.mockResolvedValue([{ id: "sr42", accountId: "a1", metadata: { fms: { billNo: "42", timestamp: "x" } } }]);
    findUniqueUser.mockReset();
    findUniqueUser.mockResolvedValue({ id: "u1", role: "SALES_USER", companyId: "c1", isActive: true });
  });

  it("returns 401 without a session and never contacts the sheet or database", async () => {
    const res = await request(app).get("/api/fms/fulfilment");
    expect(res.status).toBe(401);
    expect(fetchData).not.toHaveBeenCalled();
    expect(findManySalesRecords).not.toHaveBeenCalled();
  });

  it("returns fulfilment rows joined to the synced sales record for any signed-in role", async () => {
    const rows = sheetRows();
    fetchData.mockResolvedValue({ status: "ok", body: { success: true, sheet: "FMS", count: rows.length, totalRows: rows.length, data: rows } });

    const res = await request(app).get("/api/fms/fulfilment?page=1&pageSize=10").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, headerRowIndex: 2, page: 1, pageSize: 10, dataSourceType: "EXTERNAL_DATA" });
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0]).toMatchObject({
      billNo: "42",
      salesRecord: { status: "matched", salesRecordId: "sr42", matchedBy: "bill_no" },
      stepsWithActual: 1,
    });
    expect(res.body.orders[0].steps).toHaveLength(5);
    expect(JSON.stringify(res.body)).not.toMatch(/script\.google(usercontent)?\.com/);
  });

  it("returns configured:false when FMS_API_URL is not set", async () => {
    fmsConfigured = false;
    const res = await request(app).get("/api/fms/fulfilment").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, message: expect.any(String) });
  });

  it("returns 502 listing the problems when the sheet layout is not recognised", async () => {
    fetchData.mockResolvedValue({ status: "ok", body: { success: true, sheet: "FMS", count: 1, totalRows: 1, data: [{ Column_1: "x" }] } });
    const res = await request(app).get("/api/fms/fulfilment").set("Cookie", cookie);
    expect(res.status).toBe(502);
    expect(res.body.error.message).toBe("The FMS sheet's layout was not recognised");
    expect(res.body.error.details.problems[0]).toMatch(/No header row/);
    expect(findManySalesRecords).not.toHaveBeenCalled();
  });

  it("returns 502 when the Apps Script is unreachable", async () => {
    fetchData.mockResolvedValue({ status: "network_error", message: "FMS API responded with HTTP 500" });
    const res = await request(app).get("/api/fms/fulfilment").set("Cookie", cookie);
    expect(res.status).toBe(502);
    expect(res.body.error.message).toBe("Failed to fetch data from the FMS API");
  });

  it("rejects an out-of-range pageSize with 400 before contacting the sheet", async () => {
    const res = await request(app).get("/api/fms/fulfilment?pageSize=500").set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("exposes no write methods on /fulfilment", async () => {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const res = await request(app)[method]("/api/fms/fulfilment").set("Cookie", cookie);
      expect(res.status).toBe(404);
    }
  });
});
