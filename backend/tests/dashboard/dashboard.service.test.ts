import { describe, it, expect } from "vitest";
import { getDashboardOverview, type DashboardPrismaDeps } from "../../src/modules/dashboard/dashboard.service.js";

function makeEmptyPrisma(): DashboardPrismaDeps {
  return {
    salesRecord: {
      aggregate: async () => ({ _sum: { orderValue: null }, _count: { _all: 0 } }),
      count: async () => 0,
      findMany: async () => [],
      groupBy: async () => [],
    },
    companyTargetState: {
      count: async () => 0,
    },
    product: {
      findUnique: async () => null,
    },
  };
}

describe("getDashboardOverview with zero sales records", () => {
  it("returns insufficient_data for every sales-derived metric instead of zero", async () => {
    const dashboard = await getDashboardOverview(makeEmptyPrisma(), "company_1");

    expect(dashboard.totalSales).toEqual({ status: "insufficient_data" });
    expect(dashboard.totalOrders).toEqual({ status: "insufficient_data" });
    expect(dashboard.totalCustomers).toEqual({ status: "insufficient_data" });
    expect(dashboard.newCustomers).toEqual({ status: "insufficient_data" });
    expect(dashboard.topProduct).toEqual({ status: "insufficient_data" });
    expect(dashboard.averageOrderValue).toEqual({ status: "insufficient_data" });
  });

  it("reports targetExpansionStateCount as a real zero, not insufficient_data — a COUNT() is always fully known", async () => {
    const dashboard = await getDashboardOverview(makeEmptyPrisma(), "company_1");
    expect(dashboard.targetExpansionStateCount).toEqual({ status: "ok", value: 0 });
  });

  it("always returns insufficient_data for conversionRate in Phase 1, regardless of sales data", async () => {
    const dashboard = await getDashboardOverview(makeEmptyPrisma(), "company_1");
    expect(dashboard.conversionRate).toEqual({ status: "insufficient_data" });
  });
});

describe("getDashboardOverview with real sales data", () => {
  function makePopulatedPrisma(): DashboardPrismaDeps {
    return {
      salesRecord: {
        aggregate: async () => ({ _sum: { orderValue: 10000 }, _count: { _all: 4 } }),
        count: async () => 2,
        findMany: async () => [{ customerName: "Acme" }, { customerName: "Beta" }, { customerName: "Gamma" }],
        groupBy: async () => [{ productId: "prod_1", _sum: { orderValue: 6000 } }],
      },
      companyTargetState: {
        count: async () => 3,
      },
      product: {
        findUnique: async () => ({ id: "prod_1", name: "Widget Pro" }),
      },
    };
  }

  it("computes real values from the underlying data instead of insufficient_data", async () => {
    const dashboard = await getDashboardOverview(makePopulatedPrisma(), "company_1");

    expect(dashboard.totalSales).toEqual({ status: "ok", value: "10000" });
    expect(dashboard.totalOrders).toEqual({ status: "ok", value: 4 });
    expect(dashboard.totalCustomers).toEqual({ status: "ok", value: 3 });
    expect(dashboard.newCustomers).toEqual({ status: "ok", value: 2 });
    expect(dashboard.targetExpansionStateCount).toEqual({ status: "ok", value: 3 });
    expect(dashboard.averageOrderValue).toEqual({ status: "ok", value: "2500.00" });
    expect(dashboard.topProduct).toEqual({
      status: "ok",
      value: { productId: "prod_1", name: "Widget Pro", totalOrderValue: "6000" },
    });
    // Still no fabricated conversion rate even with real sales data.
    expect(dashboard.conversionRate).toEqual({ status: "insufficient_data" });
  });
});
