import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { FetchFmsDataParams, FetchFmsDataResult, FmsClient } from "../../src/modules/fms/fms.client.js";

/* HTTP-level test for GET /api/sales-agent/opportunities/overdue — prisma and the FMS client are mocked. */

const findUniqueUser = vi.fn();
vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    account: {
      findMany: async (args: { where?: { id?: { in: string[] } } }) =>
        args.where?.id ? [{ id: "acc_1", name: "Acme Retail" }] : [{ id: "acc_1", name: "Acme Retail", industryId: null, stateId: null, industry: null }],
    },
    salesRecord: {
      findMany: async (args: { select: Record<string, boolean> }) =>
        args.select.metadata
          ? [{ id: "sr1", accountId: "acc_1", orderValue: "60000", cancelledAt: null, account: { id: "acc_1", name: "Acme Retail" }, metadata: { fms: { billNo: "101", timestamp: "t", orderTaken: "Ravi" } } }]
          : [],
    },
    leadScore: { findMany: async () => [] },
    product: { findMany: async () => [] },
    auditLog: { create: async () => ({}) },
  },
}));

const fetchData = vi.fn<(p: FetchFmsDataParams) => Promise<FetchFmsDataResult>>();
let configured = true;
vi.mock("../../src/modules/fms/fms-client.factory.js", () => ({
  isFmsConfigured: () => configured,
  getFmsClient: (): FmsClient | null => (configured ? { fetchData } : null),
  getCachedFmsClient: (): FmsClient | null => (configured ? { fetchData } : null),
  FMS_WARM_REQUESTS: [],
}));

const { createApp } = await import("../../src/app.js");
const { signSessionToken } = await import("../../src/lib/jwt.js");
const { SESSION_COOKIE_NAME } = await import("../../src/config/constants.js");
const { clearOpportunitiesCache } = await import("../../src/modules/opportunities/opportunities.service.js");

const app = createApp();
const cookie = `${SESSION_COOKIE_NAME}=${signSessionToken({ userId: "u1", role: "SALES_USER", companyId: "c1" })}`;
const URL_BASE = "/api/sales-agent/opportunities/overdue";

const accountProcess = [
  {
    Date: "t", "Bill No.": 101, "Customer Name": "Acme Retail", "Bill Amount": 60000, "Days O/S": "2026-01-01 00:00:00",
    "Balance Due": 50000, "Final Status": "Overdue",
  },
];

describe("GET /api/sales-agent/opportunities/overdue", () => {
  beforeEach(() => {
    clearOpportunitiesCache();
    configured = true;
    findUniqueUser.mockReset();
    findUniqueUser.mockResolvedValue({ id: "u1", role: "SALES_USER", companyId: "c1", isActive: true });
    fetchData.mockReset();
    fetchData.mockImplementation(async (p) => {
      const data = p.sheet === "Account_Process" ? accountProcess : [];
      return { status: "ok", body: { success: true, sheet: p.sheet!, count: data.length, totalRows: data.length, data: data as never } };
    });
  });

  it("returns 401 without a session", async () => {
    expect((await request(app).get(URL_BASE)).status).toBe(401);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("validates age, sort and pageSize", async () => {
    for (const q of ["age=5-10", "sort=random", "pageSize=500"]) {
      expect((await request(app).get(`${URL_BASE}?${q}`).set("Cookie", cookie)).status).toBe(400);
    }
  });

  it("returns the overdue accounts in { data, pagination } form for any signed-in role", async () => {
    const res = await request(app).get(`${URL_BASE}?page=1&pageSize=25`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      pagination: { page: 1, pageSize: 25, total: 1 },
      summary: { accounts: 1, totalOverdueAmount: "50000.00" },
    });
    expect(res.body.data[0]).toMatchObject({ accountId: "acc_1", accountName: "Acme Retail", overdueAmount: "50000.00", orderTakenBy: ["Ravi"] });
    expect(fetchData).toHaveBeenCalledWith({ sheet: "Account_Process", limit: 10000 });
  });

  it("returns configured:false when FMS isn't set up", async () => {
    configured = false;
    const res = await request(app).get(URL_BASE).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it("returns 502 when the payment sheet can't be read", async () => {
    fetchData.mockResolvedValue({ status: "network_error", message: "HTTP 500" });
    const res = await request(app).get(URL_BASE).set("Cookie", cookie);
    expect(res.status).toBe(502);
  });

  it("has no write methods", async () => {
    for (const m of ["post", "put", "patch", "delete"] as const) {
      expect((await request(app)[m](URL_BASE).set("Cookie", cookie)).status).toBe(404);
    }
  });
});

describe("GET /api/sales-agent/opportunities/overdue/:accountId/bills and /overdue/bills/:billNo", () => {
  beforeEach(() => {
    clearOpportunitiesCache();
    configured = true;
    findUniqueUser.mockReset();
    findUniqueUser.mockResolvedValue({ id: "u1", role: "SALES_USER", companyId: "c1", isActive: true });
    fetchData.mockReset();
    fetchData.mockImplementation(async (p) => {
      const data = p.sheet === "Account_Process" ? accountProcess : [];
      return { status: "ok", body: { success: true, sheet: p.sheet!, count: data.length, totalRows: data.length, data: data as never } };
    });
  });

  it("requires a session", async () => {
    expect((await request(app).get(`${URL_BASE}/acc_1/bills`)).status).toBe(401);
    expect((await request(app).get(`${URL_BASE}/bills/101`)).status).toBe(401);
  });

  it("returns a customer's overdue bills, paged", async () => {
    const res = await request(app).get(`${URL_BASE}/acc_1/bills?page=1&pageSize=10`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      account: { accountId: "acc_1", accountName: "Acme Retail" },
      summary: { overdueBills: 1, overdueAmount: "50000.00" },
      pagination: { page: 1, pageSize: 10, total: 1 },
    });
    expect(res.body.data[0]).toMatchObject({ billNo: "101", billAmount: "60000.00", balanceDue: "50000.00", customerName: "Acme Retail" });
  });

  it("404s for a customer with no overdue bills, and validates paging", async () => {
    expect((await request(app).get(`${URL_BASE}/acc_unknown/bills`).set("Cookie", cookie)).status).toBe(404);
    expect((await request(app).get(`${URL_BASE}/acc_1/bills?pageSize=500`).set("Cookie", cookie)).status).toBe(400);
  });

  it("returns a bill's details, and 404s for an unknown Bill No.", async () => {
    const res = await request(app).get(`${URL_BASE}/bills/101`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, billNo: "101" });
    expect(res.body.entries[0]).toMatchObject({ billNo: "101", balanceDue: "50000.00", finalStatus: "Overdue", account: { accountId: "acc_1" } });
    expect((await request(app).get(`${URL_BASE}/bills/999`).set("Cookie", cookie)).status).toBe(404);
  });

  it("has no write methods", async () => {
    for (const m of ["post", "put", "patch", "delete"] as const) {
      expect((await request(app)[m](`${URL_BASE}/acc_1/bills`).set("Cookie", cookie)).status).toBe(404);
      expect((await request(app)[m](`${URL_BASE}/bills/101`).set("Cookie", cookie)).status).toBe(404);
    }
  });
});

