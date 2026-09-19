import { describe, it, expect } from "vitest";
import {
  getReorderSoon,
  getInactiveCustomers,
  getHighValueAccounts,
  getHotLeads,
  getProductRecommendations,
  INACTIVE_OVERDUE_THRESHOLD_DAYS,
  INACTIVE_SINGLE_ORDER_RECENCY_THRESHOLD_DAYS,
  type AssistantPrismaDeps,
} from "../../src/modules/assistant/intent-data.service.js";

const NOW = new Date("2026-08-17T09:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * MS_PER_DAY);
}

function makeDeps(overrides: Partial<AssistantPrismaDeps> = {}): AssistantPrismaDeps {
  return {
    account: { findMany: async () => [] },
    prospect: { findMany: async () => [] },
    leadScore: { findMany: async () => [] },
    salesRecord: { findMany: async () => [] },
    product: { findMany: async () => [] },
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * Test #4: reorder_soon never includes an account with <2 real orders.
 * ---------------------------------------------------------------------- */

describe("getReorderSoon", () => {
  it("excludes an account with only 1 real order, even if that order is very old", async () => {
    const deps = makeDeps({
      account: { findMany: async () => [{ id: "acc_1", name: "Solo Order Co" }] },
      salesRecord: {
        findMany: async () => [{ accountId: "acc_1", date: daysAgo(200), orderValue: "5000" }],
      },
    });
    const result = await getReorderSoon(deps, "c1", NOW);
    expect(result).toEqual([]);
  });

  it("excludes an account with 0 real orders", async () => {
    const deps = makeDeps({ account: { findMany: async () => [{ id: "acc_1", name: "No Orders Co" }] } });
    const result = await getReorderSoon(deps, "c1", NOW);
    expect(result).toEqual([]);
  });

  it("includes an account with >=2 real orders that is overdue, with a real computed detail string", async () => {
    // Two orders 30 days apart (cycle ~30 days), most recent 40 days ago -> overdue by ~10 days.
    const deps = makeDeps({
      account: { findMany: async () => [{ id: "acc_1", name: "Regular Co" }] },
      salesRecord: {
        findMany: async () => [
          { accountId: "acc_1", date: daysAgo(70), orderValue: "1000" },
          { accountId: "acc_1", date: daysAgo(40), orderValue: "1000" },
        ],
      },
    });
    const result = await getReorderSoon(deps, "c1", NOW);
    expect(result).toHaveLength(1);
    expect(result[0].leadId).toBe("acc_1");
    expect(result[0].leadType).toBe("accounts");
    expect(result[0].score).toBeNull();
    expect(result[0].classification).toBeNull();
    expect(result[0].detail).toMatch(/Overdue by 10 days? \(usual cycle ~30 days\)/);
  });

  it("excludes a 2-order account that is not yet due (more than 7 days before its next expected order)", async () => {
    // Cycle ~30 days, most recent order 10 days ago -> overdueByDays = 10 - 30 = -20 (well before -7).
    const deps = makeDeps({
      account: { findMany: async () => [{ id: "acc_1", name: "Not Due Co" }] },
      salesRecord: {
        findMany: async () => [
          { accountId: "acc_1", date: daysAgo(40), orderValue: "1000" },
          { accountId: "acc_1", date: daysAgo(10), orderValue: "1000" },
        ],
      },
    });
    const result = await getReorderSoon(deps, "c1", NOW);
    expect(result).toEqual([]);
  });

  it("ranks most-overdue first", async () => {
    const deps = makeDeps({
      account: {
        findMany: async () => [
          { id: "acc_a", name: "A" },
          { id: "acc_b", name: "B" },
        ],
      },
      salesRecord: {
        findMany: async () => [
          // A: cycle 30, last order 45 days ago -> overdue by 15
          { accountId: "acc_a", date: daysAgo(75), orderValue: "1000" },
          { accountId: "acc_a", date: daysAgo(45), orderValue: "1000" },
          // B: cycle 30, last order 60 days ago -> overdue by 30
          { accountId: "acc_b", date: daysAgo(90), orderValue: "1000" },
          { accountId: "acc_b", date: daysAgo(60), orderValue: "1000" },
        ],
      },
    });
    const result = await getReorderSoon(deps, "c1", NOW);
    expect(result.map((r) => r.leadId)).toEqual(["acc_b", "acc_a"]);
  });
});

/* -------------------------------------------------------------------------
 * Test #5: inactive_customers threshold boundary — just under excluded,
 * just over included. Two branches: >=2 orders (cycle-relative, 30-day
 * buffer) and exactly 1 order (absolute 90-day cutoff).
 * ---------------------------------------------------------------------- */

describe("getInactiveCustomers — boundary logic", () => {
  it("excludes a >=2-order account exactly at the 30-day-overdue threshold (not strictly over)", async () => {
    // Cycle 30 days; overdueByDays must be exactly 30 (not > 30) to be excluded.
    const deps = makeDeps({
      account: { findMany: async () => [{ id: "acc_1", name: "Just Under Co" }] },
      salesRecord: {
        findMany: async () => [
          { accountId: "acc_1", date: daysAgo(90), orderValue: "1000" },
          { accountId: "acc_1", date: daysAgo(60), orderValue: "1000" }, // cycle = 30
        ],
      },
    });
    // recencyDays = 60, overdueByDays = 60 - 30 = 30 (== threshold, not > threshold)
    const result = await getInactiveCustomers(deps, "c1", NOW);
    expect(result).toEqual([]);
  });

  it("includes a >=2-order account just over the 30-day-overdue threshold", async () => {
    const deps = makeDeps({
      account: { findMany: async () => [{ id: "acc_1", name: "Just Over Co" }] },
      salesRecord: {
        findMany: async () => [
          { accountId: "acc_1", date: daysAgo(91), orderValue: "1000" },
          { accountId: "acc_1", date: daysAgo(61), orderValue: "1000" }, // cycle = 30
        ],
      },
    });
    // recencyDays = 61, overdueByDays = 61 - 30 = 31 (> 30 threshold)
    const result = await getInactiveCustomers(deps, "c1", NOW);
    expect(result).toHaveLength(1);
    expect(result[0].leadId).toBe("acc_1");
    expect(result[0].detail).toMatch(/No order in 61 days \(usual cycle ~30 days\)/);
    expect(INACTIVE_OVERDUE_THRESHOLD_DAYS).toBe(30);
  });

  it("excludes a single-order account exactly at the 90-day recency threshold (not strictly over)", async () => {
    const deps = makeDeps({
      account: { findMany: async () => [{ id: "acc_1", name: "Single Just Under" }] },
      salesRecord: { findMany: async () => [{ accountId: "acc_1", date: daysAgo(90), orderValue: "1000" }] },
    });
    const result = await getInactiveCustomers(deps, "c1", NOW);
    expect(result).toEqual([]);
  });

  it("includes a single-order account just over the 90-day recency threshold, with the single-order detail phrasing", async () => {
    const deps = makeDeps({
      account: { findMany: async () => [{ id: "acc_1", name: "Single Just Over" }] },
      salesRecord: { findMany: async () => [{ accountId: "acc_1", date: daysAgo(91), orderValue: "1000" }] },
    });
    const result = await getInactiveCustomers(deps, "c1", NOW);
    expect(result).toHaveLength(1);
    expect(result[0].detail).toBe("Only order was 91 days ago");
    expect(INACTIVE_SINGLE_ORDER_RECENCY_THRESHOLD_DAYS).toBe(90);
  });

  it("never flags an account that reorder_soon would already cover (mild overdue, e.g. 10 days)", async () => {
    const deps = makeDeps({
      account: { findMany: async () => [{ id: "acc_1", name: "Mildly Overdue Co" }] },
      salesRecord: {
        findMany: async () => [
          { accountId: "acc_1", date: daysAgo(70), orderValue: "1000" },
          { accountId: "acc_1", date: daysAgo(40), orderValue: "1000" }, // overdue by 10
        ],
      },
    });
    const result = await getInactiveCustomers(deps, "c1", NOW);
    expect(result).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * high_value_accounts — ranked by real totalOrderValue.
 * ---------------------------------------------------------------------- */

describe("getHighValueAccounts", () => {
  it("ranks accounts by real total order value descending, with an honest detail string", async () => {
    const deps = makeDeps({
      account: {
        findMany: async () => [
          { id: "acc_a", name: "Small Spender" },
          { id: "acc_b", name: "Big Spender" },
        ],
      },
      salesRecord: {
        findMany: async () => [
          { accountId: "acc_a", date: daysAgo(5), orderValue: "1000" },
          { accountId: "acc_b", date: daysAgo(5), orderValue: "9000" },
          { accountId: "acc_b", date: daysAgo(35), orderValue: "9000" },
        ],
      },
    });
    const result = await getHighValueAccounts(deps, "c1", NOW);
    expect(result.map((r) => r.leadId)).toEqual(["acc_b", "acc_a"]);
    expect(result[0].detail).toBe("Total order value ₹18,000 across 2 orders");
    expect(result[1].detail).toBe("Total order value ₹1,000 across 1 order");
  });

  it("excludes an account with zero real orders", async () => {
    const deps = makeDeps({ account: { findMany: async () => [{ id: "acc_1", name: "Never Ordered" }] } });
    const result = await getHighValueAccounts(deps, "c1", NOW);
    expect(result).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * hot_leads
 * ---------------------------------------------------------------------- */

describe("getHotLeads", () => {
  it("maps HOT leadScore rows (accounts and prospects) to result items with a real score-based detail", async () => {
    const deps = makeDeps({
      leadScore: {
        findMany: async () => [
          { accountId: "acc_1", prospectId: null, score: 91, classification: "HOT", account: { name: "Acme" } },
          { accountId: null, prospectId: "pro_1", score: 85, classification: "HOT", prospect: { businessName: "Beta Co" } },
        ],
      },
    });
    const result = await getHotLeads(deps, "c1");
    expect(result).toEqual([
      { leadId: "acc_1", leadType: "accounts", name: "Acme", score: 91, classification: "HOT", detail: "Score 91" },
      { leadId: "pro_1", leadType: "prospects", name: "Beta Co", score: 85, classification: "HOT", detail: "Score 85" },
    ]);
  });
});

/* -------------------------------------------------------------------------
 * Test #6: product_recommendations ranking correctness — a product with
 * more real matching leads outranks one with fewer, a zero-match product
 * never appears, and every returned name is one of the company's real
 * Product rows (never invented).
 * ---------------------------------------------------------------------- */

describe("getProductRecommendations", () => {
  it("ranks products by real HOT/WARM match count, excludes zero-match products, and never invents a product name", async () => {
    const deps = makeDeps({
      leadScore: {
        findMany: async () => [
          { accountId: "acc_1", prospectId: null, classification: "HOT", account: { industryId: "ind_retail" } },
          { accountId: "acc_2", prospectId: null, classification: "WARM", account: { industryId: "ind_retail" } },
          { accountId: null, prospectId: "pro_1", classification: "HOT", prospect: { industryId: "ind_mfg", businessTypeId: null } },
        ],
      },
      product: {
        findMany: async () => [
          { id: "prod_widget", name: "Widget A", targetIndustries: [{ industryId: "ind_retail" }], targetBusinessTypes: [] },
          { id: "prod_gadget", name: "Gadget B", targetIndustries: [{ industryId: "ind_mfg" }], targetBusinessTypes: [] },
          { id: "prod_unmatched", name: "Never Matches", targetIndustries: [{ industryId: "ind_unrelated" }], targetBusinessTypes: [] },
        ],
      },
    });

    const result = await getProductRecommendations(deps, "c1");

    // Widget A matches 2 retail leads, Gadget B matches 1 manufacturing lead -> Widget A ranks first.
    expect(result.map((r) => r.name)).toEqual(["Widget A", "Gadget B"]);
    expect(result[0].detail).toBe("Matches 2 current HOT/WARM leads");
    expect(result[1].detail).toBe("Matches 1 current HOT/WARM lead");

    // The zero-match product is never a top result — in fact it's excluded entirely.
    expect(result.some((r) => r.name === "Never Matches")).toBe(false);

    // Every returned name is exactly one of the company's real Product rows (never invented).
    const realProductNames = new Set(["Widget A", "Gadget B", "Never Matches"]);
    for (const item of result) {
      expect(realProductNames.has(item.name)).toBe(true);
    }

    // leadId/leadType placeholders are populated (never an empty string that would break a React key) and score/classification are honestly null (this intent's items are products, not scored leads).
    for (const item of result) {
      expect(item.leadId.length).toBeGreaterThan(0);
      expect(item.leadType).toBe("accounts");
      expect(item.score).toBeNull();
      expect(item.classification).toBeNull();
    }
  });

  it("returns an empty list (not a fabricated one) when no active product matches any current HOT/WARM lead", async () => {
    const deps = makeDeps({
      leadScore: {
        findMany: async () => [{ accountId: "acc_1", prospectId: null, classification: "HOT", account: { industryId: "ind_unrelated" } }],
      },
      product: {
        findMany: async () => [{ id: "prod_1", name: "Widget A", targetIndustries: [{ industryId: "ind_retail" }], targetBusinessTypes: [] }],
      },
    });
    const result = await getProductRecommendations(deps, "c1");
    expect(result).toEqual([]);
  });
});
