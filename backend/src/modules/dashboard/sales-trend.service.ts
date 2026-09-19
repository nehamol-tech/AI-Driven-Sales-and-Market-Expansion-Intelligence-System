/* eslint-disable @typescript-eslint/no-explicit-any */
import type { RevenueBreakdownItem, RevenueMonthPoint, SalesTrendDTO } from "@ai-sales/shared";
import {
  aggregateMonthlyRevenue,
  attachGrowthPct,
  groupOrdersInMemory,
  toBreakdownItems,
  type BreakdownSourceOrder,
} from "../revenue-analytics/revenue-analytics.service.js";

/**
 * Narrow, injectable Prisma-like dependency interface (mirrors
 * RevenueAnalyticsPrismaDeps) so this whole module is unit-testable without
 * a live DB. A real PrismaClient satisfies this structurally — no adapter
 * needed. No new Prisma model — everything here is derived live from
 * existing SalesRecord rows (plus Product/Distributor for display-name
 * lookups on the top-products/distributor-performance breakdowns).
 */
export interface SalesTrendPrismaDeps {
  salesRecord: {
    findMany(args: any): Promise<any[]>;
  };
  product: {
    findMany(args: any): Promise<any[]>;
  };
  distributor: {
    findMany(args: any): Promise<any[]>;
  };
}

export interface SalesTrendFilters {
  dateFrom?: Date;
  dateTo?: Date;
  stateId?: string;
  productId?: string;
  distributorId?: string;
}

function buildWhere(companyId: string, filters: SalesTrendFilters): Record<string, unknown> {
  const where: Record<string, unknown> = { companyId };
  if (filters.dateFrom || filters.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (filters.dateFrom) dateFilter.gte = filters.dateFrom;
    if (filters.dateTo) dateFilter.lte = filters.dateTo;
    where.date = dateFilter;
  }
  if (filters.stateId) where.stateId = filters.stateId;
  if (filters.productId) where.productId = filters.productId;
  if (filters.distributorId) where.distributorId = filters.distributorId;
  return where;
}

/**
 * Resolves a filtered set of Top Products / Distributor Performance from an
 * already-filtered, already-in-memory order list — grouping via
 * groupOrdersInMemory (revenue-analytics.service.ts's pure, in-memory
 * counterpart to groupSalesByField's DB-level groupBy) rather than a second
 * hand-rolled grouping implementation, then resolving real display names
 * with one batched findMany (never N+1), then attaching the same growthPct
 * treatment Part 1 uses (computeWindowComparison over that item's own
 * filtered orders, via attachGrowthPct).
 */
async function computeFilteredBreakdown(
  orders: BreakdownSourceOrder[],
  field: "productId" | "distributorId",
  now: Date,
  resolveNames: (ids: string[]) => Promise<Map<string, string>>,
): Promise<RevenueBreakdownItem[]> {
  const rows = groupOrdersInMemory(orders, field);
  if (rows.length === 0) return [];
  const nameById = await resolveNames(rows.map((r) => r.id));
  const items = toBreakdownItems(rows, nameById);
  return attachGrowthPct(items, orders, field, now);
}

/**
 * Top-level orchestration for GET /api/dashboard/sales-trend: queries real
 * SalesRecord rows matching every provided filter, builds the monthly series
 * via aggregateMonthlyRevenue (the same pure function revenue-analytics.
 * service.ts's own generate() uses — never reimplemented here), and derives
 * Top Products + Distributor Performance from that SAME filtered order set
 * so all three panels stay consistent with one query. Always `kind: "actual"`
 * — this is a historical filtered view, not Phase 6's forecast feature.
 *
 * Deliberately uncached — always live. Unlike the AI-narrated phases (Phase
 * 4/6/7/8/9's daily cache), there is no AI call here at all, and the space of
 * possible filter combinations is too large to usefully cache; each query is
 * cheap (indexed on companyId+date/stateId/productId/distributorId already).
 */
export async function getSalesTrend(deps: SalesTrendPrismaDeps, companyId: string, filters: SalesTrendFilters, now: Date = new Date()): Promise<SalesTrendDTO> {
  const where = buildWhere(companyId, filters);

  const rawOrders = await deps.salesRecord.findMany({
    where,
    select: { date: true, orderValue: true, productId: true, stateId: true, industryId: true, salespersonId: true, distributorId: true },
  });

  const orders = (rawOrders as any[]).map((o) => ({ date: new Date(o.date), orderValue: Number(o.orderValue) }));
  const growthOrders: BreakdownSourceOrder[] = (rawOrders as any[]).map((o) => ({
    date: new Date(o.date),
    orderValue: Number(o.orderValue),
    productId: o.productId ?? null,
    stateId: o.stateId ?? null,
    industryId: o.industryId ?? null,
    salespersonId: o.salespersonId ?? null,
    distributorId: o.distributorId ?? null,
  }));

  const monthly = aggregateMonthlyRevenue(orders);
  const series: RevenueMonthPoint[] = monthly.map((m) => ({
    monthKey: m.monthKey,
    revenue: String(Math.round(m.revenue)),
    orderCount: m.orderCount,
    kind: "actual" as const,
  }));

  const totalForFilteredRange = orders.reduce((sum, o) => sum + o.orderValue, 0);
  const orderCountForFilteredRange = orders.length;

  const [topProducts, distributorPerformance] = await Promise.all([
    computeFilteredBreakdown(growthOrders, "productId", now, async (ids) => {
      const products = await deps.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      return new Map((products as any[]).map((p) => [p.id as string, p.name as string]));
    }),
    computeFilteredBreakdown(growthOrders, "distributorId", now, async (ids) => {
      const distributors = await deps.distributor.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      return new Map((distributors as any[]).map((d) => [d.id as string, d.name as string]));
    }),
  ]);

  return {
    series,
    monthsOfHistory: monthly.length,
    totalForFilteredRange: String(Math.round(totalForFilteredRange)),
    orderCountForFilteredRange,
    topProducts,
    distributorPerformance,
  };
}
