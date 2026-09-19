import { describe, it, expect, vi } from "vitest";
import { getSalesTrend, type SalesTrendPrismaDeps, type SalesTrendFilters } from "../../src/modules/dashboard/sales-trend.service.js";
import * as revenueAnalyticsService from "../../src/modules/revenue-analytics/revenue-analytics.service.js";

interface FakeOrder {
  date: Date;
  orderValue: number;
  productId: string | null;
  stateId: string | null;
  industryId: string | null;
  salespersonId: string | null;
  distributorId: string | null;
  companyId: string;
}

/** Minimal in-memory query engine matching sales-trend.service.ts's buildWhere shape exactly, so these tests genuinely exercise the where-clause construction rather than assuming it. */
function makeDeps(orders: FakeOrder[], productNames: Record<string, string> = {}, distributorNames: Record<string, string> = {}): SalesTrendPrismaDeps {
  return {
    salesRecord: {
      findMany: async ({ where }: any) => {
        return orders.filter((o) => {
          if (o.companyId !== where.companyId) return false;
          if (where.date?.gte && o.date < where.date.gte) return false;
          if (where.date?.lte && o.date > where.date.lte) return false;
          if (where.stateId !== undefined && o.stateId !== where.stateId) return false;
          if (where.productId !== undefined && o.productId !== where.productId) return false;
          if (where.distributorId !== undefined && o.distributorId !== where.distributorId) return false;
          return true;
        });
      },
    },
    product: {
      findMany: async ({ where }: any) => (where.id.in as string[]).map((id) => ({ id, name: productNames[id] ?? id })),
    },
    distributor: {
      findMany: async ({ where }: any) => (where.id.in as string[]).map((id) => ({ id, name: distributorNames[id] ?? id })),
    },
  };
}

function order(overrides: Partial<FakeOrder>): FakeOrder {
  return {
    date: new Date("2026-06-15T00:00:00Z"),
    orderValue: 100,
    productId: null,
    stateId: null,
    industryId: null,
    salespersonId: null,
    distributorId: null,
    companyId: "c1",
    ...overrides,
  };
}

const NOW = new Date("2026-08-19T00:00:00Z");

describe("getSalesTrend filters", () => {
  it("with no filters, returns every real order for the company", async () => {
    const deps = makeDeps([order({ orderValue: 100 }), order({ orderValue: 200 }), order({ companyId: "other-co", orderValue: 999 })]);
    const result = await getSalesTrend(deps, "c1", {}, NOW);
    expect(result.orderCountForFilteredRange).toBe(2);
    expect(result.totalForFilteredRange).toBe("300");
  });

  it("dateFrom/dateTo narrows to the real range (inclusive)", async () => {
    const deps = makeDeps([
      order({ date: new Date("2026-01-01T00:00:00Z"), orderValue: 100 }),
      order({ date: new Date("2026-06-15T00:00:00Z"), orderValue: 200 }),
      order({ date: new Date("2026-12-31T00:00:00Z"), orderValue: 300 }),
    ]);
    const filters: SalesTrendFilters = { dateFrom: new Date("2026-06-01T00:00:00Z"), dateTo: new Date("2026-06-30T00:00:00Z") };
    const result = await getSalesTrend(deps, "c1", filters, NOW);
    expect(result.orderCountForFilteredRange).toBe(1);
    expect(result.totalForFilteredRange).toBe("200");
  });

  it("stateId narrows to only that state's real orders", async () => {
    const deps = makeDeps([order({ stateId: "st_a", orderValue: 100 }), order({ stateId: "st_b", orderValue: 500 })]);
    const result = await getSalesTrend(deps, "c1", { stateId: "st_a" }, NOW);
    expect(result.orderCountForFilteredRange).toBe(1);
    expect(result.totalForFilteredRange).toBe("100");
  });

  it("productId narrows to only that product's real orders", async () => {
    const deps = makeDeps([order({ productId: "p1", orderValue: 100 }), order({ productId: "p2", orderValue: 500 })]);
    const result = await getSalesTrend(deps, "c1", { productId: "p1" }, NOW);
    expect(result.orderCountForFilteredRange).toBe(1);
    expect(result.totalForFilteredRange).toBe("100");
  });

  it("distributorId narrows to only that distributor's real orders", async () => {
    const deps = makeDeps([order({ distributorId: "d1", orderValue: 100 }), order({ distributorId: "d2", orderValue: 500 })]);
    const result = await getSalesTrend(deps, "c1", { distributorId: "d1" }, NOW);
    expect(result.orderCountForFilteredRange).toBe(1);
    expect(result.totalForFilteredRange).toBe("100");
  });

  it("combines multiple filters with AND semantics", async () => {
    const deps = makeDeps([
      order({ stateId: "st_a", productId: "p1", orderValue: 100 }),
      order({ stateId: "st_a", productId: "p2", orderValue: 500 }),
      order({ stateId: "st_b", productId: "p1", orderValue: 999 }),
    ]);
    const result = await getSalesTrend(deps, "c1", { stateId: "st_a", productId: "p1" }, NOW);
    expect(result.orderCountForFilteredRange).toBe(1);
    expect(result.totalForFilteredRange).toBe("100");
  });

  it("returns a fully empty DTO (no crash) when a filter combination matches nothing", async () => {
    const deps = makeDeps([order({ stateId: "st_a", orderValue: 100 })]);
    const result = await getSalesTrend(deps, "c1", { stateId: "st_z" }, NOW);
    expect(result.orderCountForFilteredRange).toBe(0);
    expect(result.totalForFilteredRange).toBe("0");
    expect(result.series).toEqual([]);
    expect(result.monthsOfHistory).toBe(0);
    expect(result.topProducts).toEqual([]);
    expect(result.distributorPerformance).toEqual([]);
  });

  it("series points are always kind: 'actual' — never a forecast/projected point", async () => {
    const deps = makeDeps([order({ date: new Date("2026-06-01T00:00:00Z") }), order({ date: new Date("2026-07-01T00:00:00Z") })]);
    const result = await getSalesTrend(deps, "c1", {}, NOW);
    expect(result.series.every((p) => p.kind === "actual")).toBe(true);
  });

  it("derives topProducts and distributorPerformance from the SAME filtered order set, with real names resolved", async () => {
    const deps = makeDeps(
      [
        order({ stateId: "st_a", productId: "p1", distributorId: "d1", orderValue: 100 }),
        order({ stateId: "st_a", productId: "p2", distributorId: "d2", orderValue: 500 }),
        order({ stateId: "st_b", productId: "p1", distributorId: "d1", orderValue: 999 }), // excluded by stateId filter below
      ],
      { p1: "Widget", p2: "Gadget" },
      { d1: "North Distributors", d2: "South Distributors" },
    );
    const result = await getSalesTrend(deps, "c1", { stateId: "st_a" }, NOW);
    expect(result.topProducts.map((p) => ({ id: p.id, name: p.name, totalValue: p.totalValue }))).toEqual([
      { id: "p2", name: "Gadget", totalValue: "500" },
      { id: "p1", name: "Widget", totalValue: "100" },
    ]);
    expect(result.distributorPerformance.map((d) => ({ id: d.id, name: d.name, totalValue: d.totalValue }))).toEqual([
      { id: "d2", name: "South Distributors", totalValue: "500" },
      { id: "d1", name: "North Distributors", totalValue: "100" },
    ]);
  });

  it("calls the real aggregateMonthlyRevenue (not a reimplementation) to build the series", async () => {
    const spy = vi.spyOn(revenueAnalyticsService, "aggregateMonthlyRevenue");
    const deps = makeDeps([order({ date: new Date("2026-06-05T00:00:00Z"), orderValue: 100 }), order({ date: new Date("2026-06-20T00:00:00Z"), orderValue: 250 })]);
    const result = await getSalesTrend(deps, "c1", {}, NOW);
    expect(spy).toHaveBeenCalled();
    // aggregateMonthlyRevenue never synthesizes a zero-revenue gap month — confirms this is the real shared function, not a local reimplementation that might behave differently.
    expect(result.series).toEqual([{ monthKey: "2026-06", revenue: "350", orderCount: 2, kind: "actual" }]);
    spy.mockRestore();
  });
});
