import { describe, it, expect, vi, beforeEach } from "vitest";
import { PROSPECT_STATUSES } from "@ai-sales/shared";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";
import {
  aggregateMonthlyRevenue,
  computeGrowthRate,
  computeLinearForecast,
  computePipelineFunnel,
  getRevenueAnalytics,
  clearRevenueAnalyticsCache,
  runRevenueNarrativePipeline,
  computeBreakdownItemGrowthPct,
  groupOrdersInMemory,
  attachGrowthPct,
  BREAKDOWN_GROWTH_WINDOW_DAYS,
  MIN_ORDERS_FOR_GROWTH_PCT,
  FORECAST_HORIZON_MONTHS,
  TOP_BREAKDOWN_LIMIT,
  type RevenueAnalyticsPrismaDeps,
} from "../../src/modules/revenue-analytics/revenue-analytics.service.js";
import type { RevenueAnalyticsEvidence } from "../../src/modules/revenue-analytics/revenue-analytics.prompt.js";

function makeFakeAIProvider(responses: (string | Error)[]): AIProvider {
  let call = 0;
  return {
    name: "fake",
    async generateCompletion(): Promise<AIProviderCompletion> {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (response instanceof Error) throw response;
      return { content: response, usage: undefined };
    },
  };
}

function validNarrativeJson(text = "A real narrative from the given evidence."): string {
  return JSON.stringify({ narrative: text });
}

function makeEvidence(overrides: Partial<RevenueAnalyticsEvidence> = {}): RevenueAnalyticsEvidence {
  return {
    monthsOfHistory: 3,
    recentMonths: [{ monthKey: "2026-06", revenue: "10000" }],
    growthRatePercent: { status: "insufficient_data" },
    topStates: [],
    topIndustries: [],
    topProducts: [],
    topSalespeople: [],
    forecast: null,
    pipelineFunnel: PROSPECT_STATUSES.map((status) => ({ status, count: 0 })),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * aggregateMonthlyRevenue
 * ---------------------------------------------------------------------- */

describe("aggregateMonthlyRevenue", () => {
  it("buckets multiple orders in the same month correctly", () => {
    const result = aggregateMonthlyRevenue([
      { date: new Date("2026-06-05T00:00:00Z"), orderValue: 100 },
      { date: new Date("2026-06-20T00:00:00Z"), orderValue: 250 },
    ]);
    expect(result).toEqual([{ monthKey: "2026-06", revenue: 350, orderCount: 2 }]);
  });

  it("produces ascending sorted buckets across multiple months", () => {
    const result = aggregateMonthlyRevenue([
      { date: new Date("2026-08-01T00:00:00Z"), orderValue: 300 },
      { date: new Date("2026-06-01T00:00:00Z"), orderValue: 100 },
      { date: new Date("2026-07-01T00:00:00Z"), orderValue: 200 },
    ]);
    expect(result.map((r) => r.monthKey)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("returns an empty array for empty input", () => {
    expect(aggregateMonthlyRevenue([])).toEqual([]);
  });

  it("never synthesizes a zero-revenue month for a real gap — the gap is simply absent, not zero-filled", () => {
    const result = aggregateMonthlyRevenue([
      { date: new Date("2026-06-01T00:00:00Z"), orderValue: 100 },
      { date: new Date("2026-09-01T00:00:00Z"), orderValue: 200 }, // July, August missing entirely
    ]);
    expect(result.map((r) => r.monthKey)).toEqual(["2026-06", "2026-09"]);
    expect(result.some((r) => r.monthKey === "2026-07")).toBe(false);
    expect(result.some((r) => r.monthKey === "2026-08")).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * computeLinearForecast
 * ---------------------------------------------------------------------- */

describe("computeLinearForecast", () => {
  it("returns null for 0 months of data", () => {
    expect(computeLinearForecast([], 3)).toBeNull();
  });

  it("returns null for 1 month of data", () => {
    expect(computeLinearForecast([{ monthKey: "2026-06", revenue: 100 }], 3)).toBeNull();
  });

  it("hand-computed: revenue [100, 200, 300] (perfect linear trend, slope=100) forecasts [400, 500, 600]", () => {
    const monthly = [
      { monthKey: "2026-06", revenue: 100 },
      { monthKey: "2026-07", revenue: 200 },
      { monthKey: "2026-08", revenue: 300 },
    ];
    const result = computeLinearForecast(monthly, 3);
    expect(result).not.toBeNull();
    expect(result?.map((p) => p.revenue)).toEqual([400, 500, 600]);
    expect(result?.map((p) => p.monthKey)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("clamps a negative-slope projection to 0 rather than going negative", () => {
    const monthly = [
      { monthKey: "2026-06", revenue: 100 },
      { monthKey: "2026-07", revenue: 50 },
      { monthKey: "2026-08", revenue: 0 },
    ];
    const result = computeLinearForecast(monthly, 3);
    expect(result).not.toBeNull();
    for (const p of result ?? []) {
      expect(p.revenue).toBeGreaterThanOrEqual(0);
    }
    // Slope is -50/month, so by the 3rd projected point the raw line value is deep negative — must clamp to 0.
    expect(result?.[2].revenue).toBe(0);
  });

  it("increments monthKey correctly across a December -> January year boundary", () => {
    const monthly = [
      { monthKey: "2026-11", revenue: 100 },
      { monthKey: "2026-12", revenue: 200 },
    ];
    const result = computeLinearForecast(monthly, FORECAST_HORIZON_MONTHS);
    expect(result?.map((p) => p.monthKey)).toEqual(["2027-01", "2027-02", "2027-03"]);
  });
});

/* -------------------------------------------------------------------------
 * computeGrowthRate
 * ---------------------------------------------------------------------- */

describe("computeGrowthRate", () => {
  function months(revenues: number[]): { monthKey: string; revenue: number }[] {
    return revenues.map((revenue, i) => ({ monthKey: `2026-${String(i + 1).padStart(2, "0")}`, revenue }));
  }

  it("returns insufficient_data below 6 months", () => {
    expect(computeGrowthRate(months([1, 2, 3, 4, 5]))).toEqual({ status: "insufficient_data" });
  });

  it("computes the correct percentage for a known 6-month series", () => {
    // prior 3 (months 1-3): avg = (100+100+100)/3 = 100. recent 3 (months 4-6): avg = (150+150+150)/3 = 150.
    // growth = (150-100)/100 * 100 = 50%.
    const result = computeGrowthRate(months([100, 100, 100, 150, 150, 150]));
    expect(result).toEqual({ status: "ok", value: 50 });
  });

  it("priorAvg === 0 and recentAvg === 0 -> 0% growth (no divide-by-zero)", () => {
    const result = computeGrowthRate(months([0, 0, 0, 0, 0, 0]));
    expect(result).toEqual({ status: "ok", value: 0 });
  });

  it("priorAvg === 0 and recentAvg > 0 -> +100% growth (no divide-by-zero, unambiguous 'from nothing' signal)", () => {
    const result = computeGrowthRate(months([0, 0, 0, 100, 100, 100]));
    expect(result).toEqual({ status: "ok", value: 100 });
  });
});

/* -------------------------------------------------------------------------
 * computePipelineFunnel
 * ---------------------------------------------------------------------- */

describe("computePipelineFunnel", () => {
  function makeDeps(prospectGroups: any[]): RevenueAnalyticsPrismaDeps {
    return {
      salesRecord: { findMany: async () => [], groupBy: async () => [] },
      prospect: { groupBy: async () => prospectGroups },
      state: { findMany: async () => [] },
      industry: { findMany: async () => [] },
      product: { findMany: async () => [] },
      user: { findMany: async () => [] },
      distributor: { findMany: async () => [] },
    };
  }

  it("includes every PROSPECT_STATUSES value even when the DB has zero prospects total", async () => {
    const result = await computePipelineFunnel(makeDeps([]), "c1");
    expect(result.map((r) => r.status)).toEqual([...PROSPECT_STATUSES]);
    expect(result.every((r) => r.count === 0)).toBe(true);
  });

  it("matches counts from a fake groupBy result and defaults missing statuses to 0", async () => {
    const result = await computePipelineFunnel(
      makeDeps([
        { status: "NEW", _count: { _all: 5 } },
        { status: "WON", _count: { _all: 2 } },
      ]),
      "c1",
    );
    const byStatus = new Map(result.map((r) => [r.status, r.count]));
    expect(byStatus.get("NEW")).toBe(5);
    expect(byStatus.get("WON")).toBe(2);
    expect(byStatus.get("CONTACTED")).toBe(0);
    expect(byStatus.get("LOST")).toBe(0);
    expect(result).toHaveLength(PROSPECT_STATUSES.length);
  });
});

/* -------------------------------------------------------------------------
 * runRevenueNarrativePipeline
 * ---------------------------------------------------------------------- */

describe("runRevenueNarrativePipeline", () => {
  it("returns an AI-narrated result on success", async () => {
    const provider = makeFakeAIProvider([validNarrativeJson("Great real narrative.")]);
    const result = await runRevenueNarrativePipeline(provider, makeEvidence());
    expect(result.method).toBe("AI");
    expect(result.narrative).toBe("Great real narrative.");
  });

  it("retries once on malformed JSON, then succeeds if the retry is valid", async () => {
    const provider = makeFakeAIProvider(["not json at all", validNarrativeJson()]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runRevenueNarrativePipeline(provider, makeEvidence());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("AI");
  });

  it("falls back to RULE_BASED when the AI keeps returning malformed JSON after one retry", async () => {
    const provider = makeFakeAIProvider(["not json", "still { not valid"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runRevenueNarrativePipeline(provider, makeEvidence());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
    expect(result.narrative).not.toBeNull();
  });

  it("falls back to RULE_BASED when the AI throws on both attempts", async () => {
    const provider = makeFakeAIProvider([new Error("network error"), new Error("network error")]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runRevenueNarrativePipeline(provider, makeEvidence());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
  });

  it("skips the AI call entirely and returns narrative: null when monthsOfHistory === 0", async () => {
    const provider = makeFakeAIProvider(["should never be used"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runRevenueNarrativePipeline(provider, makeEvidence({ monthsOfHistory: 0 }));
    expect(spy).not.toHaveBeenCalled();
    expect(result.narrative).toBeNull();
    expect(result.method).toBe("RULE_BASED");
  });
});

/* -------------------------------------------------------------------------
 * Breakdown functions (via getRevenueAnalytics, the only exported entry
 * point that exercises them) — grouping/sorting/limiting/null-FK exclusion.
 * ---------------------------------------------------------------------- */

describe("revenue breakdowns (state/industry/product/salesperson)", () => {
  beforeEach(() => {
    clearRevenueAnalyticsCache();
  });

  const NOW = new Date("2026-08-19T00:00:00Z");

  function makeDeps(overrides: Partial<RevenueAnalyticsPrismaDeps> = {}): RevenueAnalyticsPrismaDeps {
    return {
      salesRecord: { findMany: async () => [], groupBy: async () => [] },
      prospect: { groupBy: async () => [] },
      state: { findMany: async () => [] },
      industry: { findMany: async () => [] },
      product: { findMany: async () => [] },
      user: { findMany: async () => [] },
      distributor: { findMany: async () => [] },
      ...overrides,
    };
  }

  it("sorts by totalValue desc, resolves real names, and excludes null-FK rows (which groupBy where already filters)", async () => {
    const deps = makeDeps({
      salesRecord: {
        findMany: async () => [],
        groupBy: async ({ by }: any) => {
          if (by[0] === "stateId") {
            return [
              { stateId: "st_a", _sum: { orderValue: "1000" }, _count: { _all: 2 } },
              { stateId: "st_b", _sum: { orderValue: "5000" }, _count: { _all: 1 } },
            ];
          }
          return [];
        },
      },
      state: {
        findMany: async () => [
          { id: "st_a", name: "Kerala" },
          { id: "st_b", name: "Goa" },
        ],
      },
    });
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const result = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(result.dto.byState).toEqual([
      { id: "st_b", name: "Goa", totalValue: "5000", orderCount: 1, growthPct: null },
      { id: "st_a", name: "Kerala", totalValue: "1000", orderCount: 2, growthPct: null },
    ]);
  });

  it("limits each breakdown to TOP_BREAKDOWN_LIMIT entries", async () => {
    const groups = Array.from({ length: TOP_BREAKDOWN_LIMIT + 5 }, (_, i) => ({
      productId: `prod_${i}`,
      _sum: { orderValue: String(1000 - i) },
      _count: { _all: 1 },
    }));
    const deps = makeDeps({
      salesRecord: {
        findMany: async () => [],
        groupBy: async ({ by }: any) => (by[0] === "productId" ? groups : []),
      },
      product: {
        findMany: async ({ where }: any) => (where.id.in as string[]).map((id: string) => ({ id, name: id })),
      },
    });
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const result = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(result.dto.byProduct).toHaveLength(TOP_BREAKDOWN_LIMIT);
  });

  it("returns an empty breakdown (no name lookup call) when groupBy returns no rows", async () => {
    const stateFindManySpy = vi.fn(async () => []);
    const deps = makeDeps({ state: { findMany: stateFindManySpy } });
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const result = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(result.dto.byState).toEqual([]);
    expect(stateFindManySpy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------
 * getRevenueAnalytics — full orchestration (cache, force, generatedAt).
 * ---------------------------------------------------------------------- */

describe("getRevenueAnalytics orchestration", () => {
  beforeEach(() => {
    clearRevenueAnalyticsCache();
  });

  const NOW = new Date("2026-08-19T00:00:00Z");

  function makeDepsWithOrders(): RevenueAnalyticsPrismaDeps {
    return {
      salesRecord: {
        findMany: async () => [
          { date: new Date("2026-06-01T00:00:00Z"), orderValue: "1000" },
          { date: new Date("2026-07-01T00:00:00Z"), orderValue: "2000" },
        ],
        groupBy: async () => [],
      },
      prospect: { groupBy: async () => [] },
      state: { findMany: async () => [] },
      industry: { findMany: async () => [] },
      product: { findMany: async () => [] },
      user: { findMany: async () => [] },
      distributor: { findMany: async () => [] },
    };
  }

  it("caches the generated result for the rest of the day — a second same-day call does not re-hit the DB or re-call AI", async () => {
    const deps = makeDepsWithOrders();
    const findManySpy = vi.spyOn(deps.salesRecord, "findMany");
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const aiSpy = vi.spyOn(provider, "generateCompletion");

    const first = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(first.wasGenerated).toBe(true);
    expect(findManySpy).toHaveBeenCalledTimes(1);

    const second = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: new Date(NOW.getTime() + 3 * 60 * 60 * 1000) });
    expect(second.wasGenerated).toBe(false);
    expect(findManySpy).toHaveBeenCalledTimes(1);
    expect(aiSpy).toHaveBeenCalledTimes(1);
    expect(second.dto.generatedAt).toBe(first.dto.generatedAt);
  });

  it("force=true bypasses the cache and regenerates", async () => {
    const deps = makeDepsWithOrders();
    const findManySpy = vi.spyOn(deps.salesRecord, "findMany");
    const provider = makeFakeAIProvider([validNarrativeJson()]);

    await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(findManySpy).toHaveBeenCalledTimes(1);

    const forced = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: true, now: NOW });
    expect(forced.wasGenerated).toBe(true);
    expect(findManySpy).toHaveBeenCalledTimes(2);
  });

  it("builds the series as real months ascending then projected months appended", async () => {
    const deps = makeDepsWithOrders();
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const result = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(result.dto.monthsOfHistory).toBe(2);
    expect(result.dto.forecastMonths).toBe(FORECAST_HORIZON_MONTHS);
    expect(result.dto.series).toHaveLength(2 + FORECAST_HORIZON_MONTHS);
    expect(result.dto.series[0]).toMatchObject({ monthKey: "2026-06", kind: "actual" });
    expect(result.dto.series[1]).toMatchObject({ monthKey: "2026-07", kind: "actual" });
    expect(result.dto.series[2].kind).toBe("projected");
    expect(result.dto.series[2].orderCount).toBe(0);
    expect(result.dto.totalRevenueAllTime).toBe("3000");
  });

  it("returns narrative: null and an empty forecast tail when there are zero real orders", async () => {
    const deps: RevenueAnalyticsPrismaDeps = {
      salesRecord: { findMany: async () => [], groupBy: async () => [] },
      prospect: { groupBy: async () => [] },
      state: { findMany: async () => [] },
      industry: { findMany: async () => [] },
      product: { findMany: async () => [] },
      user: { findMany: async () => [] },
      distributor: { findMany: async () => [] },
    };
    const provider = makeFakeAIProvider(["should never be used"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(spy).not.toHaveBeenCalled();
    expect(result.dto.monthsOfHistory).toBe(0);
    expect(result.dto.forecastMonths).toBe(0);
    expect(result.dto.series).toEqual([]);
    expect(result.dto.narrative).toBeNull();
    expect(result.dto.narrativeMethod).toBe("RULE_BASED");
  });

  it("every pipelineFunnel stage is present in the final DTO", async () => {
    const deps = makeDepsWithOrders();
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const result = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(result.dto.pipelineFunnel.map((p) => p.status)).toEqual([...PROSPECT_STATUSES]);
  });
});

/* -------------------------------------------------------------------------
 * computeBreakdownItemGrowthPct — per-item growth% (Phase 10 dashboard
 * redesign). Hand-computed expected values, plus the null-on-zero-prior and
 * null-on-insufficient-orders documented edge cases.
 * ---------------------------------------------------------------------- */

describe("computeBreakdownItemGrowthPct", () => {
  const NOW = new Date("2026-08-19T00:00:00Z");

  function daysAgo(days: number): Date {
    return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
  }

  it("hand-computed: recent window totals 1500, prior window totals 1000 -> +50%", () => {
    // recent (last 60 days): 2 orders totaling 1500. prior (60-120 days ago): 2 orders totaling 1000.
    const orders = [
      { date: daysAgo(10), orderValue: 1000 },
      { date: daysAgo(20), orderValue: 500 },
      { date: daysAgo(70), orderValue: 600 },
      { date: daysAgo(90), orderValue: 400 },
    ];
    expect(computeBreakdownItemGrowthPct(orders, NOW)).toBe(50);
  });

  it("hand-computed: recent window totals 500, prior window totals 1000 -> -50%", () => {
    const orders = [
      { date: daysAgo(10), orderValue: 500 },
      { date: daysAgo(70), orderValue: 1000 },
    ];
    expect(computeBreakdownItemGrowthPct(orders, NOW)).toBe(-50);
  });

  it("returns null when the prior window's value is exactly 0, even with real recent orders — never a fabricated +100%", () => {
    const orders = [
      { date: daysAgo(5), orderValue: 1000 },
      { date: daysAgo(10), orderValue: 1000 },
    ];
    expect(computeBreakdownItemGrowthPct(orders, NOW)).toBeNull();
  });

  it("returns null when both windows are 0 (no orders at all)", () => {
    expect(computeBreakdownItemGrowthPct([], NOW)).toBeNull();
  });

  it("returns null when there are fewer than MIN_ORDERS_FOR_GROWTH_PCT combined real orders across both windows", () => {
    expect(MIN_ORDERS_FOR_GROWTH_PCT).toBe(2);
    // Exactly 1 real order total (in the prior window, so it's not even $0 that trips it up) — still insufficient evidence.
    const orders = [{ date: daysAgo(70), orderValue: 500 }];
    expect(computeBreakdownItemGrowthPct(orders, NOW)).toBeNull();
  });

  it("does not null out once MIN_ORDERS_FOR_GROWTH_PCT combined real orders are present and prior value is nonzero", () => {
    const orders = [
      { date: daysAgo(10), orderValue: 200 },
      { date: daysAgo(70), orderValue: 100 },
    ];
    expect(computeBreakdownItemGrowthPct(orders, NOW)).toBe(100);
  });

  it("an order landing exactly on the recent/prior boundary is counted in the PRIOR window (computeWindowComparison's own documented tie-break)", () => {
    // BREAKDOWN_GROWTH_WINDOW_DAYS days ago exactly == the boundary.
    const boundary = new Date(NOW.getTime() - BREAKDOWN_GROWTH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const orders = [
      { date: boundary, orderValue: 1000 },
      { date: daysAgo(5), orderValue: 500 },
    ];
    // boundary order -> prior window (1000), recent window -> 500. growth = (500-1000)/1000*100 = -50%.
    expect(computeBreakdownItemGrowthPct(orders, NOW)).toBe(-50);
  });
});

/* -------------------------------------------------------------------------
 * groupOrdersInMemory / attachGrowthPct — pure in-memory grouping used by
 * sales-trend.service.ts to rank a pre-filtered order set without a second
 * DB round trip or a hand-rolled second groupBy implementation.
 * ---------------------------------------------------------------------- */

describe("groupOrdersInMemory", () => {
  it("groups by the given field, sums totalValue/orderCount, sorts desc, and skips null-FK rows", () => {
    const orders = [
      { date: new Date(), orderValue: 100, productId: "p1", stateId: null, industryId: null, salespersonId: null, distributorId: null },
      { date: new Date(), orderValue: 50, productId: "p1", stateId: null, industryId: null, salespersonId: null, distributorId: null },
      { date: new Date(), orderValue: 500, productId: "p2", stateId: null, industryId: null, salespersonId: null, distributorId: null },
      { date: new Date(), orderValue: 20, productId: null, stateId: null, industryId: null, salespersonId: null, distributorId: null },
    ];
    const result = groupOrdersInMemory(orders, "productId");
    expect(result).toEqual([
      { id: "p2", totalValue: 500, orderCount: 1 },
      { id: "p1", totalValue: 150, orderCount: 2 },
    ]);
  });

  it("caps at TOP_BREAKDOWN_LIMIT entries", () => {
    const orders = Array.from({ length: TOP_BREAKDOWN_LIMIT + 5 }, (_, i) => ({
      date: new Date(),
      orderValue: 1000 - i,
      productId: `p${i}`,
      stateId: null,
      industryId: null,
      salespersonId: null,
      distributorId: null,
    }));
    expect(groupOrdersInMemory(orders, "productId")).toHaveLength(TOP_BREAKDOWN_LIMIT);
  });
});

describe("attachGrowthPct", () => {
  it("filters the full order set down to each item's own orders by the given FK field before computing growthPct", () => {
    const NOW = new Date("2026-08-19T00:00:00Z");
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
    const orders = [
      { date: daysAgo(10), orderValue: 200, productId: "p1", stateId: null, industryId: null, salespersonId: null, distributorId: null },
      { date: daysAgo(70), orderValue: 100, productId: "p1", stateId: null, industryId: null, salespersonId: null, distributorId: null },
      { date: daysAgo(10), orderValue: 999, productId: "p2", stateId: null, industryId: null, salespersonId: null, distributorId: null },
    ];
    const items = [
      { id: "p1", name: "Widget", totalValue: "300", orderCount: 2 },
      { id: "p3", name: "NoOrders", totalValue: "0", orderCount: 0 },
    ];
    const result = attachGrowthPct(items, orders, "productId", NOW);
    expect(result[0].growthPct).toBe(100); // p1: recent 200 vs prior 100 -> +100%
    expect(result[1].growthPct).toBeNull(); // p3 has zero matching orders -> insufficient evidence
  });
});

/* -------------------------------------------------------------------------
 * computeDistributorBreakdown / byDistributor — via getRevenueAnalytics,
 * mirrors byProduct's own coverage exactly (new FK, same pattern).
 * ---------------------------------------------------------------------- */

describe("byDistributor breakdown", () => {
  beforeEach(() => {
    clearRevenueAnalyticsCache();
  });

  const NOW = new Date("2026-08-19T00:00:00Z");

  function makeDeps(overrides: Partial<RevenueAnalyticsPrismaDeps> = {}): RevenueAnalyticsPrismaDeps {
    return {
      salesRecord: { findMany: async () => [], groupBy: async () => [] },
      prospect: { groupBy: async () => [] },
      state: { findMany: async () => [] },
      industry: { findMany: async () => [] },
      product: { findMany: async () => [] },
      user: { findMany: async () => [] },
      distributor: { findMany: async () => [] },
      ...overrides,
    };
  }

  it("groups real SalesRecords by distributorId, resolves real Distributor.name, sorts desc", async () => {
    const deps = makeDeps({
      salesRecord: {
        findMany: async () => [],
        groupBy: async ({ by }: any) =>
          by[0] === "distributorId"
            ? [
                { distributorId: "dist_a", _sum: { orderValue: "2000" }, _count: { _all: 3 } },
                { distributorId: "dist_b", _sum: { orderValue: "9000" }, _count: { _all: 1 } },
              ]
            : [],
      },
      distributor: {
        findMany: async () => [
          { id: "dist_a", name: "North Distributors" },
          { id: "dist_b", name: "South Distributors" },
        ],
      },
    });
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const result = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(result.dto.byDistributor).toEqual([
      { id: "dist_b", name: "South Distributors", totalValue: "9000", orderCount: 1, growthPct: null },
      { id: "dist_a", name: "North Distributors", totalValue: "2000", orderCount: 3, growthPct: null },
    ]);
  });

  it("returns an empty byDistributor (no name lookup call) when there are no distributor-linked orders", async () => {
    const distributorFindManySpy = vi.fn(async () => []);
    const deps = makeDeps({ distributor: { findMany: distributorFindManySpy } });
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const result = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(result.dto.byDistributor).toEqual([]);
    expect(distributorFindManySpy).not.toHaveBeenCalled();
  });

  it("computes a real growthPct per distributor from the same rawOrders pass used for the monthly series", async () => {
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
    const deps = makeDeps({
      salesRecord: {
        findMany: async () => [
          { date: daysAgo(10), orderValue: "600", productId: null, stateId: null, industryId: null, salespersonId: null, distributorId: "dist_a" },
          { date: daysAgo(70), orderValue: "300", productId: null, stateId: null, industryId: null, salespersonId: null, distributorId: "dist_a" },
        ],
        groupBy: async ({ by }: any) =>
          by[0] === "distributorId" ? [{ distributorId: "dist_a", _sum: { orderValue: "900" }, _count: { _all: 2 } }] : [],
      },
      distributor: { findMany: async () => [{ id: "dist_a", name: "North Distributors" }] },
    });
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const result = await getRevenueAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    // recent (last 60 days): 600. prior (60-120 days ago): 300. growth = (600-300)/300*100 = 100%.
    expect(result.dto.byDistributor).toEqual([{ id: "dist_a", name: "North Distributors", totalValue: "900", orderCount: 2, growthPct: 100 }]);
  });
});
