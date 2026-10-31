/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MetricValue, DashboardOverviewDTO } from "@ai-sales/shared";

/**
 * Narrow dependency interface (rather than the full PrismaClient) so unit
 * tests can pass a lightweight fake implementing just these methods.
 */
export interface DashboardPrismaDeps {
  salesRecord: {
    aggregate(args: any): Promise<any>;
    count(args: any): Promise<number>;
    findMany(args: any): Promise<any[]>;
    groupBy(args: any): Promise<any[]>;
  };
  companyTargetState: {
    count(args: any): Promise<number>;
  };
  product: {
    findUnique(args: any): Promise<{ id: string; name: string } | null>;
  };
}

function ok<T>(value: T): MetricValue<T> {
  return { status: "ok", value };
}

const insufficientData: MetricValue<never> = { status: "insufficient_data" };

export async function getDashboardOverview(prisma: DashboardPrismaDeps, companyId: string): Promise<DashboardOverviewDTO> {
  const where = { companyId, cancelledAt: null };

  const [salesAggregate, totalCustomerRows, newCustomers, targetExpansionStateCount, topProductGroup] = await Promise.all([
    prisma.salesRecord.aggregate({ where, _sum: { orderValue: true }, _count: { _all: true } }),
    prisma.salesRecord.findMany({ where, distinct: ["customerName"], select: { customerName: true } }),
    prisma.salesRecord.count({ where: { ...where, isNewCustomer: true } }),
    prisma.companyTargetState.count({ where: { companyId } }),
    prisma.salesRecord.groupBy({
      by: ["productId"],
      where: { ...where, productId: { not: null } },
      _sum: { orderValue: true },
      orderBy: { _sum: { orderValue: "desc" } },
      take: 1,
    }),
  ]);

  const totalOrders = salesAggregate._count._all;
  const hasSales = totalOrders > 0;

  const totalSalesValue = salesAggregate._sum.orderValue;
  const totalSales: MetricValue<string> = hasSales && totalSalesValue !== null ? ok(String(totalSalesValue)) : insufficientData;

  const totalOrdersMetric: MetricValue<number> = hasSales ? ok(totalOrders) : insufficientData;
  const totalCustomers: MetricValue<number> = hasSales ? ok(totalCustomerRows.length) : insufficientData;
  const newCustomersMetric: MetricValue<number> = hasSales ? ok(newCustomers) : insufficientData;

  // A COUNT() is always fully known, even when it's zero — unlike the sales-
  // derived metrics above, a company with no target states yet has a real
  // answer ("0"), not an "insufficient data" one.
  const targetExpansionStateCountMetric: MetricValue<number> = ok(targetExpansionStateCount);

  let topProduct: DashboardOverviewDTO["topProduct"] = insufficientData;
  const topGroup = topProductGroup[0];
  if (hasSales && topGroup?.productId && topGroup._sum.orderValue !== null) {
    const product = await prisma.product.findUnique({ where: { id: topGroup.productId } });
    if (product) {
      topProduct = ok({
        productId: product.id,
        name: product.name,
        totalOrderValue: String(topGroup._sum.orderValue),
      });
    }
  }

  const averageOrderValue: MetricValue<string> =
    hasSales && totalSalesValue !== null ? ok((Number(totalSalesValue) / totalOrders).toFixed(2)) : insufficientData;

  return {
    totalSales,
    totalOrders: totalOrdersMetric,
    totalCustomers,
    newCustomers: newCustomersMetric,
    targetExpansionStateCount: targetExpansionStateCountMetric,
    topProduct,
    averageOrderValue,
    // Phase 1 has no lead/prospect data yet, so a real conversion rate
    // cannot be computed. Always insufficient_data — never invented.
    conversionRate: insufficientData,
  };
}
