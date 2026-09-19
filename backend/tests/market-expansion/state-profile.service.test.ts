import { describe, it, expect } from "vitest";
import { gatherStateProfiles, type MarketExpansionPrismaDeps } from "../../src/modules/market-expansion/state-profile.service.js";

function makeDeps(overrides: Partial<MarketExpansionPrismaDeps> = {}): MarketExpansionPrismaDeps {
  return {
    state: { findMany: async () => [] },
    salesRecord: { findMany: async () => [] },
    account: { findMany: async () => [] },
    prospect: { findMany: async () => [] },
    leadScore: { findMany: async () => [] },
    product: { findMany: async () => [] },
    ...overrides,
  };
}

describe("gatherStateProfiles", () => {
  it("returns one profile per real seeded state, even for states with zero data", async () => {
    const deps = makeDeps({
      state: {
        findMany: async () => [
          { id: "st_1", name: "Kerala" },
          { id: "st_2", name: "Goa" },
        ],
      },
    });
    const { profiles } = await gatherStateProfiles(deps, "c1");
    expect(profiles).toHaveLength(2);
    expect(profiles.map((p) => p.stateId).sort()).toEqual(["st_1", "st_2"]);
    const goa = profiles.find((p) => p.stateId === "st_2")!;
    expect(goa.accountCount).toBe(0);
    expect(goa.prospectCount).toBe(0);
    expect(goa.orderCount).toBe(0);
    expect(goa.totalSalesValue).toBe(0);
    expect(goa.averageOrderValue).toBeNull();
    expect(goa.topIndustry).toBeNull();
    expect(goa.distinctRealIndustryIds).toEqual([]);
  });

  it("counts real accounts/prospects per state, and hot/warm accounts from the latest real LeadScore only", async () => {
    const deps = makeDeps({
      state: { findMany: async () => [{ id: "st_1", name: "Kerala" }] },
      account: {
        findMany: async () => [
          { id: "acc_1", stateId: "st_1", industryId: "ind_1" },
          { id: "acc_2", stateId: "st_1", industryId: "ind_1" },
          { id: "acc_3", stateId: "st_1", industryId: null },
          { id: "acc_4", stateId: null, industryId: "ind_1" }, // no state -> excluded entirely
        ],
      },
      prospect: {
        findMany: async () => [
          { id: "p_1", stateId: "st_1" },
          { id: "p_2", stateId: null }, // excluded
        ],
      },
      leadScore: {
        findMany: async () => [
          { accountId: "acc_1", classification: "HOT" },
          { accountId: "acc_2", classification: "WARM" },
          { accountId: "acc_3", classification: "COLD" },
        ],
      },
    });

    const { profiles } = await gatherStateProfiles(deps, "c1");
    const kerala = profiles[0];
    expect(kerala.accountCount).toBe(3);
    expect(kerala.prospectCount).toBe(1);
    expect(kerala.hotAccountCount).toBe(1);
    expect(kerala.warmAccountCount).toBe(1);
  });

  it("builds real industry/city/product breakdowns from SalesRecord, sorted by totalValue desc, with the correct topIndustry", async () => {
    const deps = makeDeps({
      state: { findMany: async () => [{ id: "st_1", name: "Kerala" }] },
      account: {
        findMany: async () => [
          { id: "acc_1", stateId: "st_1", industryId: "ind_mfg" },
          { id: "acc_2", stateId: "st_1", industryId: "ind_retail" },
        ],
      },
      salesRecord: {
        findMany: async () => [
          {
            stateId: "st_1",
            cityId: "city_1",
            industryId: "ind_mfg",
            productId: "prod_a",
            date: new Date("2026-01-01"),
            orderValue: "70000",
            city: { name: "Kochi" },
            industry: { name: "Manufacturing" },
            product: { name: "Product A" },
          },
          {
            stateId: "st_1",
            cityId: "city_1",
            industryId: "ind_retail",
            productId: "prod_b",
            date: new Date("2026-01-05"),
            orderValue: "30000",
            city: { name: "Kochi" },
            industry: { name: "Retail" },
            product: { name: "Product B" },
          },
        ],
      },
    });

    const { profiles } = await gatherStateProfiles(deps, "c1");
    const kerala = profiles[0];

    expect(kerala.orderCount).toBe(2);
    expect(kerala.totalSalesValue).toBe(100_000);
    expect(kerala.averageOrderValue).toBe(50_000);

    expect(kerala.industryBreakdown.map((i) => i.industryName)).toEqual(["Manufacturing", "Retail"]); // sorted desc by totalValue
    expect(kerala.topIndustry?.industryName).toBe("Manufacturing");
    expect(kerala.topIndustry?.accountCount).toBe(1); // real Account.industryId count, independent of order count
    expect(kerala.distinctRealIndustryIds.sort()).toEqual(["ind_mfg", "ind_retail"]);

    expect(kerala.cityBreakdown).toHaveLength(1);
    expect(kerala.cityBreakdown[0]).toMatchObject({ cityId: "city_1", cityName: "Kochi", orderCount: 2, totalValue: 100_000 });

    expect(kerala.productBreakdown.map((p) => p.productName)).toEqual(["Product A", "Product B"]);
  });

  it("never attributes a SalesRecord with a null stateId to any state", async () => {
    const deps = makeDeps({
      state: { findMany: async () => [{ id: "st_1", name: "Kerala" }] },
      salesRecord: {
        findMany: async () => [{ stateId: null, cityId: null, industryId: null, productId: null, date: new Date(), orderValue: "999999", city: null, industry: null, product: null }],
      },
    });
    const { profiles } = await gatherStateProfiles(deps, "c1");
    expect(profiles[0].orderCount).toBe(0);
    expect(profiles[0].totalSalesValue).toBe(0);
  });

  it("returns the company's active products with their real target-industry ids", async () => {
    const deps = makeDeps({
      state: { findMany: async () => [] },
      product: {
        findMany: async () => [{ id: "prod_a", name: "Product A", targetIndustries: [{ industryId: "ind_mfg" }, { industryId: "ind_retail" }] }],
      },
    });
    const { products } = await gatherStateProfiles(deps, "c1");
    expect(products).toEqual([{ id: "prod_a", name: "Product A", targetIndustryIds: ["ind_mfg", "ind_retail"] }]);
  });
});
