import { describe, it, expect } from "vitest";
import {
  classifyMarket,
  computeCustomerQualityScore,
  computeExistingDemandScore,
  computeGrowth,
  computeIndustryFitScore,
  computeMatchingProductCount,
  computeMaxTotalSalesValueAcrossStatesWithOrders,
  computeProductFitScore,
  computeWhitespaceScore,
  scoreState,
  MARKET_HIGH_THRESHOLD,
  MARKET_MEDIUM_THRESHOLD,
  MARKET_WHITESPACE_SATURATION_ACCOUNTS,
} from "../../src/modules/market-expansion/market-scoring.js";
import type { ProductCandidate, StateProfile } from "../../src/modules/market-expansion/state-profile.service.js";

const NOW = new Date("2026-08-17T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function makeProfile(overrides: Partial<StateProfile> = {}): StateProfile {
  return {
    stateId: "st_1",
    stateName: "Maharashtra",
    accountCount: 0,
    prospectCount: 0,
    orderCount: 0,
    totalSalesValue: 0,
    averageOrderValue: null,
    hotAccountCount: 0,
    warmAccountCount: 0,
    industryBreakdown: [],
    topIndustry: null,
    cityBreakdown: [],
    productBreakdown: [],
    orders: [],
    distinctRealIndustryIds: [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * Sub-score unit tests
 * ---------------------------------------------------------------------- */

describe("computeExistingDemandScore", () => {
  it("is 0 when the state has no orders, regardless of the company-wide max", () => {
    const profile = makeProfile({ orderCount: 0, totalSalesValue: 0 });
    expect(computeExistingDemandScore(profile, 1_000_000)).toBe(0);
  });

  it("is 0 when the company-wide max is 0 (guarded division by zero)", () => {
    const profile = makeProfile({ orderCount: 2, totalSalesValue: 5000 });
    expect(computeExistingDemandScore(profile, 0)).toBe(0);
  });

  it("is 100 when this state IS the company-wide max", () => {
    const profile = makeProfile({ orderCount: 5, totalSalesValue: 500_000 });
    expect(computeExistingDemandScore(profile, 500_000)).toBe(100);
  });

  it("scales proportionally otherwise", () => {
    const profile = makeProfile({ orderCount: 2, totalSalesValue: 250_000 });
    expect(computeExistingDemandScore(profile, 1_000_000)).toBe(25);
  });
});

describe("computeMaxTotalSalesValueAcrossStatesWithOrders", () => {
  it("ignores states with zero orders and returns the real max among the rest", () => {
    const profiles = [
      makeProfile({ stateId: "a", orderCount: 0, totalSalesValue: 999_999_999 }), // no real orders -> ignored even though the field is nonzero-looking
      makeProfile({ stateId: "b", orderCount: 3, totalSalesValue: 200_000 }),
      makeProfile({ stateId: "c", orderCount: 1, totalSalesValue: 500_000 }),
    ];
    expect(computeMaxTotalSalesValueAcrossStatesWithOrders(profiles)).toBe(500_000);
  });

  it("is 0 when no state has any real orders", () => {
    const profiles = [makeProfile({ orderCount: 0 }), makeProfile({ orderCount: 0 })];
    expect(computeMaxTotalSalesValueAcrossStatesWithOrders(profiles)).toBe(0);
  });
});

describe("computeCustomerQualityScore", () => {
  it("is 0 when there are no accounts", () => {
    expect(computeCustomerQualityScore(makeProfile({ accountCount: 0 }))).toBe(0);
  });

  it("is 100 (capped) for an all-HOT state", () => {
    expect(computeCustomerQualityScore(makeProfile({ accountCount: 4, hotAccountCount: 4, warmAccountCount: 0 }))).toBe(100);
  });

  it("is 50 for an all-WARM state", () => {
    expect(computeCustomerQualityScore(makeProfile({ accountCount: 4, hotAccountCount: 0, warmAccountCount: 4 }))).toBe(50);
  });

  it("is 0 for a state whose accounts are all COLD/AT_RISK (no HOT or WARM credit)", () => {
    expect(computeCustomerQualityScore(makeProfile({ accountCount: 4, hotAccountCount: 0, warmAccountCount: 0 }))).toBe(0);
  });
});

describe("computeMatchingProductCount / computeProductFitScore", () => {
  const products: ProductCandidate[] = [
    { id: "p1", name: "Product A", targetIndustryIds: ["ind_mfg"] },
    { id: "p2", name: "Product B", targetIndustryIds: ["ind_retail"] },
    { id: "p3", name: "Product C", targetIndustryIds: ["ind_mfg", "ind_retail"] },
  ];

  it("is 0 when the state has no real industries represented yet (nothing to match against)", () => {
    const profile = makeProfile({ distinctRealIndustryIds: [] });
    expect(computeMatchingProductCount([], products)).toBe(0);
    expect(computeProductFitScore(profile, products.length, 0)).toBe(0);
  });

  it("is 0 when the company has no active products", () => {
    const profile = makeProfile({ distinctRealIndustryIds: ["ind_mfg"] });
    expect(computeProductFitScore(profile, 0, 0)).toBe(0);
  });

  it("counts every product whose real targetIndustryIds intersects the state's real industries", () => {
    const matching = computeMatchingProductCount(["ind_mfg"], products);
    expect(matching).toBe(2); // p1 and p3
  });

  it("computes the fraction of active products that match", () => {
    const profile = makeProfile({ distinctRealIndustryIds: ["ind_mfg"] });
    const matching = computeMatchingProductCount(profile.distinctRealIndustryIds, products);
    expect(computeProductFitScore(profile, products.length, matching)).toBeCloseTo((2 / 3) * 100);
  });
});

describe("computeIndustryFitScore (test #7 — only claims strength when real order volume supports it)", () => {
  it("is 0 when there are no real orders", () => {
    expect(computeIndustryFitScore(makeProfile({ orderCount: 0, topIndustry: null }))).toBe(0);
  });

  it("is 0 when orders exist but none carry a real industryId (topIndustry null)", () => {
    expect(computeIndustryFitScore(makeProfile({ orderCount: 3, totalSalesValue: 3000, topIndustry: null }))).toBe(0);
  });

  it("correctly identifies the top industry by real totalValue and reflects real concentration", () => {
    const industryBreakdown = [
      { industryId: "ind_mfg", industryName: "Manufacturing", accountCount: 2, orderCount: 4, totalValue: 80_000 },
      { industryId: "ind_retail", industryName: "Retail", accountCount: 1, orderCount: 2, totalValue: 20_000 },
    ];
    const profile = makeProfile({ orderCount: 6, totalSalesValue: 100_000, industryBreakdown, topIndustry: industryBreakdown[0] });
    expect(profile.topIndustry?.industryName).toBe("Manufacturing"); // highest totalValue, not first-inserted
    expect(computeIndustryFitScore(profile)).toBe(80);
  });

  it("is 100 when all real order value is concentrated in a single real industry", () => {
    const industryBreakdown = [{ industryId: "ind_mfg", industryName: "Manufacturing", accountCount: 1, orderCount: 3, totalValue: 50_000 }];
    const profile = makeProfile({ orderCount: 3, totalSalesValue: 50_000, industryBreakdown, topIndustry: industryBreakdown[0] });
    expect(computeIndustryFitScore(profile)).toBe(100);
  });
});

describe("computeWhitespaceScore (existing strong market vs. underdeveloped market)", () => {
  it("equals productFitScore when there are zero accounts (fully underdeveloped -> full whitespace credit)", () => {
    expect(computeWhitespaceScore(80, 0)).toBe(80);
  });

  it("is 0 once accountCount reaches the saturation constant (no longer underdeveloped)", () => {
    expect(computeWhitespaceScore(80, MARKET_WHITESPACE_SATURATION_ACCOUNTS)).toBe(0);
    expect(computeWhitespaceScore(80, MARKET_WHITESPACE_SATURATION_ACCOUNTS + 10)).toBe(0); // never negative
  });

  it("scales down linearly in between", () => {
    expect(computeWhitespaceScore(100, MARKET_WHITESPACE_SATURATION_ACCOUNTS / 2)).toBeCloseTo(50);
  });
});

/* -------------------------------------------------------------------------
 * Growth signal (test #5): fires with real documented history; returns
 * insufficient_data with too little history — never a fabricated trend.
 * ---------------------------------------------------------------------- */

describe("computeGrowth (test #5)", () => {
  it("returns insufficient_data with fewer than the minimum real orders", () => {
    const profile = makeProfile({ orders: [{ date: daysAgo(10), orderValue: 1000 }] });
    const result = computeGrowth(profile, NOW);
    expect(result.signal).toEqual({ status: "insufficient_data" });
    expect(result.score).toBe(0);
  });

  it("returns insufficient_data when real orders exist but don't span enough real days", () => {
    const profile = makeProfile({
      orders: [
        { date: daysAgo(5), orderValue: 1000 },
        { date: daysAgo(4), orderValue: 1000 },
        { date: daysAgo(3), orderValue: 1000 },
      ],
    });
    expect(computeGrowth(profile, NOW).signal).toEqual({ status: "insufficient_data" });
  });

  it("returns insufficient_data when there is no real prior-window activity to compare against", () => {
    // 2 real orders in the recent window (>=60-day span satisfied by a 3rd, much older order that
    // falls entirely outside BOTH the recent and prior comparison windows) — priorValue is 0, so
    // there is nothing real to divide by for a % change.
    const profile = makeProfile({
      orders: [
        { date: daysAgo(5), orderValue: 1000 },
        { date: daysAgo(10), orderValue: 1000 },
        { date: daysAgo(150), orderValue: 1000 },
      ],
    });
    expect(computeGrowth(profile, NOW).signal).toEqual({ status: "insufficient_data" });
  });

  it("fires with a real, documented increase given enough real history", () => {
    const orders = [
      { date: daysAgo(10), orderValue: 200_000 },
      { date: daysAgo(20), orderValue: 200_000 },
      { date: daysAgo(30), orderValue: 200_000 },
      { date: daysAgo(40), orderValue: 200_000 },
      { date: daysAgo(70), orderValue: 50_000 },
      { date: daysAgo(80), orderValue: 50_000 },
      { date: daysAgo(90), orderValue: 50_000 },
      { date: daysAgo(100), orderValue: 50_000 },
    ];
    const profile = makeProfile({ orders });
    const result = computeGrowth(profile, NOW);
    expect(result.signal.status).toBe("ok");
    if (result.signal.status === "ok") {
      expect(result.signal.recentValue).toBe("800000");
      expect(result.signal.priorValue).toBe("200000");
      expect(result.signal.growthPct).toBeCloseTo(3.0);
    }
    expect(result.score).toBe(100); // capped at 100 even though growthPct is 300%
  });

  it("clamps a real decline to a score of 0 (never negative)", () => {
    const orders = [
      { date: daysAgo(10), orderValue: 10_000 },
      { date: daysAgo(20), orderValue: 10_000 },
      { date: daysAgo(70), orderValue: 100_000 },
      { date: daysAgo(80), orderValue: 100_000 },
    ];
    const profile = makeProfile({ orders });
    const result = computeGrowth(profile, NOW);
    expect(result.signal.status).toBe("ok");
    expect(result.score).toBe(0);
  });
});

/* -------------------------------------------------------------------------
 * classifyMarket
 * ---------------------------------------------------------------------- */

describe("classifyMarket", () => {
  it("is INSUFFICIENT_DATA when there is literally zero real evidence, regardless of score", () => {
    const profile = makeProfile({ accountCount: 0, prospectCount: 0, orderCount: 0 });
    expect(classifyMarket(profile, 90)).toBe("INSUFFICIENT_DATA"); // even a nonsense high score can't override zero evidence
  });

  it("is HIGH_OPPORTUNITY at/above the high threshold when real evidence exists", () => {
    const profile = makeProfile({ accountCount: 1 });
    expect(classifyMarket(profile, MARKET_HIGH_THRESHOLD)).toBe("HIGH_OPPORTUNITY");
  });

  it("is MEDIUM_OPPORTUNITY between the medium and high thresholds", () => {
    const profile = makeProfile({ accountCount: 1 });
    expect(classifyMarket(profile, MARKET_MEDIUM_THRESHOLD)).toBe("MEDIUM_OPPORTUNITY");
    expect(classifyMarket(profile, MARKET_HIGH_THRESHOLD - 1)).toBe("MEDIUM_OPPORTUNITY");
  });

  it("is EMERGING below the medium threshold when real evidence exists", () => {
    const profile = makeProfile({ accountCount: 1 });
    expect(classifyMarket(profile, MARKET_MEDIUM_THRESHOLD - 1)).toBe("EMERGING");
    expect(classifyMarket(profile, 0)).toBe("EMERGING");
  });
});

/* -------------------------------------------------------------------------
 * scoreState — full integration of the 6 sub-scores + classification.
 * Tests #1, #2, #3, #4, #8.
 * ---------------------------------------------------------------------- */

describe("scoreState", () => {
  const products: ProductCandidate[] = [
    { id: "p1", name: "Product A", targetIndustryIds: ["ind_mfg"] },
    { id: "p2", name: "Product B", targetIndustryIds: ["ind_mfg"] },
  ];

  function strongProfile(): StateProfile {
    const industryBreakdown = [{ industryId: "ind_mfg", industryName: "Manufacturing", accountCount: 10, orderCount: 8, totalValue: 1_000_000 }];
    return makeProfile({
      stateId: "st_strong",
      stateName: "Maharashtra",
      accountCount: 10,
      prospectCount: 5,
      hotAccountCount: 8,
      warmAccountCount: 2,
      orderCount: 8,
      totalSalesValue: 1_000_000,
      averageOrderValue: 125_000,
      industryBreakdown,
      topIndustry: industryBreakdown[0],
      distinctRealIndustryIds: ["ind_mfg"],
      orders: [
        { date: daysAgo(10), orderValue: 200_000 },
        { date: daysAgo(20), orderValue: 200_000 },
        { date: daysAgo(30), orderValue: 200_000 },
        { date: daysAgo(40), orderValue: 200_000 },
        { date: daysAgo(70), orderValue: 50_000 },
        { date: daysAgo(80), orderValue: 50_000 },
        { date: daysAgo(90), orderValue: 50_000 },
        { date: daysAgo(100), orderValue: 50_000 },
      ],
    });
  }

  it("test #1 — a strong existing state (high demand, high customer quality, high industry fit) is classified HIGH_OPPORTUNITY", () => {
    const profile = strongProfile();
    const result = scoreState(profile, { now: NOW, maxTotalSalesValueAcrossStatesWithOrders: 1_000_000, totalActiveProductCount: products.length, products });
    expect(result.classification).toBe("HIGH_OPPORTUNITY");
    expect(result.score).not.toBeNull();
    expect(result.score as number).toBeGreaterThanOrEqual(MARKET_HIGH_THRESHOLD);
    expect(result.subScores.existingDemand).toBe(100);
    expect(result.subScores.customerQuality).toBe(90);
    expect(result.subScores.productFit).toBe(100);
    expect(result.subScores.industryFit).toBe(100);
    expect(result.subScores.growth).toBe(100);
    // An existing strong market (accountCount 10 >= saturation) has naturally LOW whitespace — this is the documented distinction from an underdeveloped market.
    expect(result.subScores.whitespace).toBe(0);
  });

  it("test #2 — a weak-but-real state (some real evidence, low sub-scores) lands in MEDIUM_OPPORTUNITY or EMERGING per the thresholds", () => {
    const industryBreakdown = [{ industryId: "ind_retail", industryName: "Retail", accountCount: 1, orderCount: 2, totalValue: 10_000 }];
    const profile = makeProfile({
      stateId: "st_weak",
      stateName: "Sikkim",
      accountCount: 3,
      prospectCount: 1,
      hotAccountCount: 0,
      warmAccountCount: 1,
      orderCount: 2,
      totalSalesValue: 10_000,
      averageOrderValue: 5_000,
      industryBreakdown,
      topIndustry: industryBreakdown[0],
      distinctRealIndustryIds: ["ind_retail"],
      orders: [
        { date: daysAgo(5), orderValue: 5_000 },
        { date: daysAgo(6), orderValue: 5_000 },
      ],
    });
    const weakProducts: ProductCandidate[] = [
      { id: "p1", name: "Product A", targetIndustryIds: ["ind_retail"] },
      { id: "p2", name: "Product B", targetIndustryIds: ["ind_mfg"] },
    ];
    const result = scoreState(profile, { now: NOW, maxTotalSalesValueAcrossStatesWithOrders: 1_000_000, totalActiveProductCount: weakProducts.length, products: weakProducts });
    expect(result.classification).not.toBe("HIGH_OPPORTUNITY");
    expect(result.classification).not.toBe("INSUFFICIENT_DATA");
    expect(["MEDIUM_OPPORTUNITY", "EMERGING"]).toContain(result.classification);
    expect(result.score).not.toBeNull();
  });

  it("test #3 — a state with real evidence but very sparse (1 account, no orders) is EMERGING, not INSUFFICIENT_DATA", () => {
    const profile = makeProfile({ stateId: "st_sparse", stateName: "Mizoram", accountCount: 1, prospectCount: 0, orderCount: 0 });
    const result = scoreState(profile, { now: NOW, maxTotalSalesValueAcrossStatesWithOrders: 1_000_000, totalActiveProductCount: products.length, products });
    expect(result.classification).toBe("EMERGING");
    expect(result.score).not.toBeNull(); // real evidence exists, so a real (low) score is reported — never a fabricated null
  });

  it("test #4 — a truly zero-evidence state is INSUFFICIENT_DATA with score null and no fabricated evidence", () => {
    const profile = makeProfile({ stateId: "st_empty", stateName: "Lakshadweep", accountCount: 0, prospectCount: 0, orderCount: 0 });
    const result = scoreState(profile, { now: NOW, maxTotalSalesValueAcrossStatesWithOrders: 1_000_000, totalActiveProductCount: products.length, products });
    expect(result.classification).toBe("INSUFFICIENT_DATA");
    expect(result.score).toBeNull();
    expect(result.subScores).toEqual({ existingDemand: 0, customerQuality: 0, productFit: 0, industryFit: 0, growth: 0, whitespace: 0 });
  });

  it("test #8 — is a pure function: identical input produces an identical result every time, no AI involved", () => {
    const profile = strongProfile();
    const ctx = { now: NOW, maxTotalSalesValueAcrossStatesWithOrders: 1_000_000, totalActiveProductCount: products.length, products };
    const first = scoreState(profile, ctx);
    const second = scoreState(profile, ctx);
    const third = scoreState(structuredClone(profile), { ...ctx, products: [...products] });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});
