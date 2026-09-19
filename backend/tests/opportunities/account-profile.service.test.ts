import { describe, it, expect } from "vitest";
import { computeWindowComparison, gatherAccountProfiles, type OpportunitiesPrismaDeps } from "../../src/modules/opportunities/account-profile.service.js";

describe("computeWindowComparison", () => {
  const now = new Date("2026-08-17T00:00:00Z");

  it("splits real orders into adjacent recent/prior windows", () => {
    const orders = [
      { date: new Date("2026-08-10T00:00:00Z"), orderValue: 1000 }, // 7 days ago -> recent
      { date: new Date("2026-07-01T00:00:00Z"), orderValue: 2000 }, // 47 days ago -> recent (within 60)
      { date: new Date("2026-06-01T00:00:00Z"), orderValue: 3000 }, // 77 days ago -> prior (60-120)
      { date: new Date("2026-01-01T00:00:00Z"), orderValue: 5000 }, // way older -> neither window
    ];
    const result = computeWindowComparison(orders, now, 60);
    expect(result.recentCount).toBe(2);
    expect(result.recentValue).toBe(3000);
    expect(result.priorCount).toBe(1);
    expect(result.priorValue).toBe(3000);
  });

  it("returns all zeros when there are no orders", () => {
    expect(computeWindowComparison([], now, 60)).toEqual({ recentCount: 0, recentValue: 0, priorCount: 0, priorValue: 0 });
  });

  it("counts an order exactly at the recent/prior boundary as PRIOR (documented tie-break)", () => {
    const boundary = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const result = computeWindowComparison([{ date: boundary, orderValue: 500 }], now, 60);
    expect(result.recentCount).toBe(0);
    expect(result.priorCount).toBe(1);
  });

  it("counts an order exactly at `now` as RECENT", () => {
    const result = computeWindowComparison([{ date: now, orderValue: 500 }], now, 60);
    expect(result.recentCount).toBe(1);
    expect(result.priorCount).toBe(0);
  });
});

describe("gatherAccountProfiles", () => {
  function makeDeps(overrides: Partial<OpportunitiesPrismaDeps> = {}): OpportunitiesPrismaDeps {
    return {
      account: { findMany: async () => [] },
      salesRecord: { findMany: async () => [] },
      leadScore: { findMany: async () => [] },
      product: { findMany: async () => [] },
      ...overrides,
    };
  }

  it("returns no profiles when the company has no accounts, but still returns real active products", async () => {
    const deps = makeDeps({
      product: { findMany: async () => [{ id: "p1", name: "Widget", targetIndustries: [], targetBusinessTypes: [] }] },
    });
    const result = await gatherAccountProfiles(deps, "c1", new Date());
    expect(result.profiles).toEqual([]);
    expect(result.products).toEqual([{ id: "p1", name: "Widget", targetIndustryIds: [], targetBusinessTypeIds: [] }]);
  });

  it("assembles a real per-account profile from Account + SalesRecord + LeadScore + Product", async () => {
    const now = new Date("2026-08-17T00:00:00Z");
    const deps = makeDeps({
      account: {
        findMany: async () => [
          { id: "acc_1", name: "Acme Retail", industryId: "ind_1", stateId: "state_1", industry: { name: "Retail" } },
        ],
      },
      salesRecord: {
        findMany: async () => [
          { accountId: "acc_1", date: new Date("2026-06-01"), orderValue: "30000", productId: "p1" },
          { accountId: "acc_1", date: new Date("2026-07-06"), orderValue: "60000", productId: "p2" },
        ],
      },
      leadScore: {
        findMany: async () => [{ accountId: "acc_1", score: 88, classification: "HOT" }],
      },
      product: {
        findMany: async () => [{ id: "p3", name: "Widget C", targetIndustries: [{ industryId: "ind_1" }], targetBusinessTypes: [] }],
      },
    });

    const result = await gatherAccountProfiles(deps, "c1", now);
    expect(result.profiles).toHaveLength(1);
    const profile = result.profiles[0];
    expect(profile.id).toBe("acc_1");
    expect(profile.orderCount).toBe(2);
    expect(profile.totalOrderValue).toBe(90000);
    expect(profile.industryId).toBe("ind_1");
    expect(profile.industryName).toBe("Retail");
    expect(profile.businessTypeId).toBeNull();
    expect(profile.distinctOwnedProductIds.sort()).toEqual(["p1", "p2"]);
    expect(profile.latestScore).toBe(88);
    expect(profile.latestClassification).toBe("HOT");
    expect(profile.averageReorderIntervalDays).toBe(35); // 2026-06-01 -> 2026-07-06 = 35 days
    expect(result.products).toEqual([{ id: "p3", name: "Widget C", targetIndustryIds: ["ind_1"], targetBusinessTypeIds: [] }]);
  });

  it("leaves score/classification null for an account with no LeadScore yet", async () => {
    const deps = makeDeps({
      account: { findMany: async () => [{ id: "acc_2", name: "Beta Co", industryId: null, stateId: null, industry: null }] },
    });
    const result = await gatherAccountProfiles(deps, "c1", new Date());
    expect(result.profiles[0].latestScore).toBeNull();
    expect(result.profiles[0].latestClassification).toBeNull();
    expect(result.profiles[0].orderCount).toBe(0);
    expect(result.profiles[0].recencyDays).toBeNull();
  });
});
