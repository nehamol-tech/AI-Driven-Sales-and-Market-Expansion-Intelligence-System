import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

/* -------------------------------------------------------------------------
 * HTTP-level test for GET /api/sales-agent/opportunities/accounts. Prisma is
 * mocked (auth lookup, the four reads the detectors use, and the audit log
 * the existing generation path writes) — no real database is touched.
 * ---------------------------------------------------------------------- */

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const auditCreate = vi.fn(async () => ({}));
const findUniqueUser = vi.fn();

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    account: {
      findMany: async () => [
        { id: "acc_1", name: "Acme Retail", industryId: null, stateId: null, industry: null },
        { id: "decoy_1", name: "Decoy One", industryId: null, stateId: null, industry: null },
        { id: "decoy_2", name: "Decoy Two", industryId: null, stateId: null, industry: null },
        { id: "decoy_3", name: "Decoy Three", industryId: null, stateId: null, industry: null },
      ],
    },
    salesRecord: {
      findMany: async () => [
        { accountId: "acc_1", date: new Date(NOW - 150 * DAY), orderValue: "10000", productId: null },
        { accountId: "acc_1", date: new Date(NOW - 90 * DAY), orderValue: "10000", productId: null },
        { accountId: "decoy_1", date: new Date(NOW - 5 * DAY), orderValue: "5000000", productId: null },
        { accountId: "decoy_2", date: new Date(NOW - 5 * DAY), orderValue: "6000000", productId: null },
        { accountId: "decoy_3", date: new Date(NOW - 5 * DAY), orderValue: "7000000", productId: null },
      ],
    },
    leadScore: { findMany: async () => [] },
    product: { findMany: async () => [] },
    auditLog: { create: (...args: unknown[]) => auditCreate(...args) },
  },
}));

const { createApp } = await import("../../src/app.js");
const { signSessionToken } = await import("../../src/lib/jwt.js");
const { SESSION_COOKIE_NAME } = await import("../../src/config/constants.js");
const { clearOpportunitiesCache } = await import("../../src/modules/opportunities/opportunities.service.js");

const app = createApp();
const cookie = `${SESSION_COOKIE_NAME}=${signSessionToken({ userId: "u1", role: "SALES_USER", companyId: "c1" })}`;

describe("GET /api/sales-agent/opportunities/accounts", () => {
  beforeEach(() => {
    clearOpportunitiesCache();
    auditCreate.mockClear();
    findUniqueUser.mockReset();
    findUniqueUser.mockResolvedValue({ id: "u1", role: "SALES_USER", companyId: "c1", isActive: true });
  });

  it("returns 401 without a session", async () => {
    const res = await request(app).get("/api/sales-agent/opportunities/accounts?type=REORDER");
    expect(res.status).toBe(401);
  });

  it("requires a valid card type", async () => {
    expect((await request(app).get("/api/sales-agent/opportunities/accounts").set("Cookie", cookie)).status).toBe(400);
    expect((await request(app).get("/api/sales-agent/opportunities/accounts?type=NOPE").set("Cookie", cookie)).status).toBe(400);
  });

  it("caps pageSize at the app's usual maximum", async () => {
    const res = await request(app).get("/api/sales-agent/opportunities/accounts?type=REORDER&pageSize=500").set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("returns the card's rows in the app's { data, pagination } shape for any signed-in role, matching the summary count", async () => {
    const res = await request(app).get("/api/sales-agent/opportunities/accounts?type=REORDER&page=1&pageSize=25").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      category: "REORDER",
      categoryTotal: 1,
      categoryAccountCount: 1,
      pagination: { page: 1, pageSize: 25, total: 1 },
    });
    expect(res.body.data[0]).toMatchObject({ accountId: "acc_1", accountName: "Acme Retail", type: "REORDER", orderCount: 2, totalOrderValue: "20000.00" });

    const summary = await request(app).get("/api/sales-agent/opportunities").set("Cookie", cookie);
    expect(summary.body.counts.REORDER).toBe(res.body.categoryTotal);
    expect(summary.body.generatedAt).toBe(res.body.generatedAt);
  });

  it("writes the usual generation audit entry only when it had to generate", async () => {
    await request(app).get("/api/sales-agent/opportunities/accounts?type=HIGH_PRIORITY").set("Cookie", cookie);
    await request(app).get("/api/sales-agent/opportunities/accounts?type=HIGH_PRIORITY&page=2").set("Cookie", cookie);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0]).toMatchObject({ data: expect.objectContaining({ action: "OPPORTUNITIES_GENERATED" }) });
  });

  it("ignores force — the list can never trigger a forced regeneration", async () => {
    await request(app).get("/api/sales-agent/opportunities/accounts?type=REORDER").set("Cookie", cookie);
    await request(app).get("/api/sales-agent/opportunities/accounts?type=REORDER&force=true").set("Cookie", cookie);
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });
});
