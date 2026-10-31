/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PipelineFunnelStageDTO, RevenueAnalyticsDTO, RevenueBreakdownItem, RevenueMonthPoint, ScoreMethod } from "@ai-sales/shared";
import { PROSPECT_STATUSES } from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import { computeWindowComparison } from "../opportunities/account-profile.service.js";
import { buildRevenueAnalyticsPrompt, type RevenueAnalyticsEvidence, type RevenueAnalyticsNamedTotal } from "./revenue-analytics.prompt.js";
import { parseAIRevenueNarrative } from "./revenue-analytics.schema.js";

/**
 * Narrow, injectable Prisma-like dependency interface (mirrors
 * MarketExpansionPrismaDeps / DashboardPrismaDeps) so this whole module is
 * unit-testable without a live DB. A real PrismaClient satisfies this
 * structurally — no adapter needed. No new Prisma model is introduced by
 * this feature — everything here is derived live from existing SalesRecord/
 * Prospect rows (plus State/Industry/Product/User for display-name lookups
 * on the breakdown ids), exactly like Market Expansion needed zero new
 * persisted models.
 */
export interface RevenueAnalyticsPrismaDeps {
  salesRecord: {
    findMany(args: any): Promise<any[]>;
    groupBy(args: any): Promise<any[]>;
  };
  prospect: {
    groupBy(args: any): Promise<any[]>;
  };
  state: {
    findMany(args: any): Promise<any[]>;
  };
  industry: {
    findMany(args: any): Promise<any[]>;
  };
  product: {
    findMany(args: any): Promise<any[]>;
  };
  user: {
    findMany(args: any): Promise<any[]>;
  };
  /** Added for the Phase 10 dashboard redesign's distributor breakdown — same batched id->name lookup shape as state/industry/product/user above. */
  distributor: {
    findMany(args: any): Promise<any[]>;
  };
}

export const FORECAST_HORIZON_MONTHS = 3;
export const MIN_MONTHS_FOR_FORECAST = 2;
export const MIN_MONTHS_FOR_GROWTH = 6;
export const TOP_BREAKDOWN_LIMIT = 8;

/* -------------------------------------------------------------------------
 * Pure computation functions — no I/O, fully unit-testable in isolation.
 * ---------------------------------------------------------------------- */

export interface MonthlyRevenueBucket {
  monthKey: string;
  revenue: number;
  orderCount: number;
}

/**
 * Buckets real orders by UTC calendar month ("YYYY-MM", matching the UTC
 * convention already established by follow-ups.service.ts's
 * startOfUTCDay/dueByDateRange — nothing in this codebase carries a
 * per-user timezone). Deliberately does NOT synthesize a zero-revenue entry
 * for a month with no real orders — only months with at least one real
 * order appear, sorted ascending. This mirrors market-expansion's "only
 * real states with evidence get ranked" philosophy: we never invent a $0
 * month that never happened just to fill a gap in the series.
 */
export function aggregateMonthlyRevenue(orders: { date: Date; orderValue: number }[]): MonthlyRevenueBucket[] {
  const byMonth = new Map<string, { revenue: number; orderCount: number }>();
  for (const o of orders) {
    const monthKey = o.date.toISOString().slice(0, 7);
    const entry = byMonth.get(monthKey) ?? { revenue: 0, orderCount: 0 };
    entry.revenue += o.orderValue;
    entry.orderCount += 1;
    byMonth.set(monthKey, entry);
  }
  return Array.from(byMonth.entries())
    .map(([monthKey, v]) => ({ monthKey, revenue: v.revenue, orderCount: v.orderCount }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

/** Plain calendar-month arithmetic on a "YYYY-MM" key — no date library needed, handles year rollover. */
function addMonthsToKey(monthKey: string, n: number): string {
  const [yearStr, monthStr] = monthKey.split("-");
  const zeroBasedMonth = Number(monthStr) - 1 + n;
  const year = Number(yearStr) + Math.floor(zeroBasedMonth / 12);
  const month = ((zeroBasedMonth % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export interface ForecastPoint {
  monthKey: string;
  revenue: number;
}

/**
 * Fits a least-squares linear regression (y = a + b*x, x = 0..N-1 real
 * month index in order, y = that month's real revenue) over the real
 * monthly series and projects `horizonMonths` points forward. Returns null
 * when there isn't enough real history (< MIN_MONTHS_FOR_FORECAST months)
 * to fit a meaningful trend line — never fabricates a forecast from too
 * little data. Projected revenue is clamped to a minimum of 0 (revenue
 * can't be negative), and each projected point's monthKey is derived by
 * incrementing forward from the last real month.
 */
export function computeLinearForecast(monthly: { monthKey: string; revenue: number }[], horizonMonths: number): ForecastPoint[] | null {
  const n = monthly.length;
  if (n < MIN_MONTHS_FOR_FORECAST) return null;

  const xs = monthly.map((_, i) => i);
  const ys = monthly.map((m) => m.revenue);
  const sumX = xs.reduce((sum, x) => sum + x, 0);
  const sumY = ys.reduce((sum, y) => sum + y, 0);
  const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
  const sumX2 = xs.reduce((sum, x) => sum + x * x, 0);

  const denominator = n * sumX2 - sumX * sumX;
  // Unreachable given this function's own input construction — x is always
  // exactly 0..n-1 (n >= MIN_MONTHS_FOR_FORECAST >= 2), so the x values can
  // never all be identical and this denominator can never be 0. Guarded
  // defensively anyway rather than trusting that invariant silently.
  if (denominator === 0) return null;

  const b = (n * sumXY - sumX * sumY) / denominator;
  const a = (sumY - b * sumX) / n;

  const lastMonthKey = monthly[n - 1].monthKey;
  const points: ForecastPoint[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    const x = n + i;
    const revenue = Math.max(0, a + b * x);
    points.push({ monthKey: addMonthsToKey(lastMonthKey, i + 1), revenue });
  }
  return points;
}

export type GrowthRateResult = { status: "ok"; value: number } | { status: "insufficient_data" };

/**
 * Compares the average revenue of the most recent 3 real months against the
 * 3 real months immediately before those. Requires at least
 * MIN_MONTHS_FOR_GROWTH real months on file, otherwise "insufficient_data"
 * — never a guessed trend from too little history.
 *
 * `priorAvg === 0` edge case: division by zero is avoided by treating "went
 * from literally $0 to $0" as 0% growth, and "went from $0 to something
 * real" as a flat +100% (there's no meaningful percentage for growth off a
 * zero base, so 100% is used as an unambiguous "went from nothing to
 * something" signal rather than +Infinity).
 */
export function computeGrowthRate(monthly: { monthKey: string; revenue: number }[]): GrowthRateResult {
  if (monthly.length < MIN_MONTHS_FOR_GROWTH) {
    return { status: "insufficient_data" };
  }
  const n = monthly.length;
  const recent = monthly.slice(n - 3);
  const prior = monthly.slice(n - 6, n - 3);
  const recentAvg = recent.reduce((sum, m) => sum + m.revenue, 0) / 3;
  const priorAvg = prior.reduce((sum, m) => sum + m.revenue, 0) / 3;
  const growthPercent = priorAvg === 0 ? (recentAvg === 0 ? 0 : 100) : ((recentAvg - priorAvg) / priorAvg) * 100;
  return { status: "ok", value: Math.round(growthPercent * 10) / 10 };
}

/**
 * Every PROSPECT_STATUSES value always appears, defaulting to count: 0 when
 * the company has no prospects in that stage — a COUNT is always fully
 * known, even when it's zero (mirrors dashboard.service.ts's
 * targetExpansionStateCount comment and follow-ups.service.ts's summary
 * counts, both documented as never "insufficient_data" for a plain count).
 */
export async function computePipelineFunnel(deps: RevenueAnalyticsPrismaDeps, companyId: string): Promise<PipelineFunnelStageDTO[]> {
  const groups = await deps.prospect.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } });
  const countByStatus = new Map<string, number>();
  for (const g of groups as any[]) {
    countByStatus.set(g.status as string, g._count._all as number);
  }
  return PROSPECT_STATUSES.map((status) => ({ status, count: countByStatus.get(status) ?? 0 }));
}

/* -------------------------------------------------------------------------
 * Revenue breakdowns (by state/industry/product/salesperson) — real
 * SalesRecord rows grouped by the relevant FK via Prisma's groupBy (not
 * hand-rolled in JS, unlike the monthly bucketing above which genuinely
 * needs JS-side date-truncation since Postgres month-truncation isn't
 * expressible via Prisma's query builder). Mirrors the groupBy+_sum+_count
 * pattern accounts.service.ts already uses (dashboard.service.ts's
 * topProductGroup only sums, no count, since it doesn't need one). Null-FK
 * rows are skipped the same way dashboard.service.ts already does
 * (`productId: { not: null }`) — a legacy SalesRecord may have no
 * stateId/industryId/productId/salespersonId. Display names are resolved
 * with one batched findMany per breakdown (`id: { in: [...] }`), never N+1
 * per-row lookups.
 * ---------------------------------------------------------------------- */

export type BreakdownField = "stateId" | "industryId" | "productId" | "salespersonId" | "distributorId";

export interface RawBreakdownRow {
  id: string;
  totalValue: number;
  orderCount: number;
}

async function groupSalesByField(deps: RevenueAnalyticsPrismaDeps, companyId: string, field: BreakdownField): Promise<RawBreakdownRow[]> {
  const groups = await deps.salesRecord.groupBy({
    by: [field],
    where: { companyId, [field]: { not: null }, cancelledAt: null },
    _sum: { orderValue: true },
    _count: { _all: true },
  });
  return (groups as any[])
    .map((g) => ({ id: g[field] as string, totalValue: Number(g._sum.orderValue ?? 0), orderCount: g._count._all as number }))
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, TOP_BREAKDOWN_LIMIT);
}

export function toBreakdownItems(rows: RawBreakdownRow[], nameById: Map<string, string>): RevenueBreakdownItem[] {
  return rows.map((r) => ({
    id: r.id,
    name: nameById.get(r.id) ?? "Unknown",
    totalValue: String(Math.round(r.totalValue)),
    orderCount: r.orderCount,
  }));
}

/**
 * Groups an already-in-memory order list by one FK field, sums value/counts
 * orders, sorts desc, caps at TOP_BREAKDOWN_LIMIT — the same shape
 * groupSalesByField produces (RawBreakdownRow[]), but computed purely in JS
 * over a caller-supplied (typically pre-filtered) order array rather than a
 * fresh `prisma.groupBy` call. Used by sales-trend.service.ts to rank
 * Top Products / Distributor Performance over an already-filtered order set
 * without a second DB round trip and without hand-rolling a second
 * group/rank implementation. Null-FK rows are skipped, same as
 * groupSalesByField's `{ [field]: { not: null } }` where clause.
 */
export function groupOrdersInMemory(orders: BreakdownSourceOrder[], field: BreakdownField): RawBreakdownRow[] {
  const byId = new Map<string, { totalValue: number; orderCount: number }>();
  for (const o of orders) {
    const id = o[field];
    if (!id) continue;
    const entry = byId.get(id) ?? { totalValue: 0, orderCount: 0 };
    entry.totalValue += o.orderValue;
    entry.orderCount += 1;
    byId.set(id, entry);
  }
  return Array.from(byId.entries())
    .map(([id, v]) => ({ id, totalValue: v.totalValue, orderCount: v.orderCount }))
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, TOP_BREAKDOWN_LIMIT);
}

/* -------------------------------------------------------------------------
 * Per-item growth% — new for the Phase 10 dashboard redesign's "Growth
 * Opportunities" / "Problems to Fix" panels. Compares each individual
 * breakdown item's (one product/state/distributor/etc.) own order value in
 * the most recent real BREAKDOWN_GROWTH_WINDOW_DAYS days against the prior
 * window of the same length — reusing computeWindowComparison
 * (account-profile.service.ts) verbatim, the same 60-day window
 * detectAtRisk/detectGrowingAccount already use for account-level growth/
 * decline, for consistency across the app.
 * ---------------------------------------------------------------------- */

/** Matches AT_RISK_WINDOW_DAYS/GROWING_WINDOW_DAYS in opportunities/detectors.ts — same window, applied one level down (per product/state/distributor/etc. instead of per account). */
export const BREAKDOWN_GROWTH_WINDOW_DAYS = 60;

/**
 * Minimum combined real order count across both the recent and prior window
 * before a growthPct is reported at all. Below this, a 60-day window at the
 * single-item level is just too thin an evidence base to trust — one lonely
 * order landing on either side of the window boundary can otherwise swing
 * the percentage wildly. Documented, deliberately low threshold (not "many
 * orders needed") since many real products/distributors/territories will
 * legitimately have only a handful of orders in any 120-day span.
 */
export const MIN_ORDERS_FOR_GROWTH_PCT = 2;

/** The subset of a raw SalesRecord row this module needs for per-item growth computation — one shape shared by generate() (unfiltered, whole-company) and sales-trend.service.ts (pre-filtered). */
export interface BreakdownSourceOrder {
  date: Date;
  orderValue: number;
  productId: string | null;
  stateId: string | null;
  industryId: string | null;
  salespersonId: string | null;
  distributorId: string | null;
}

/**
 * growthPct for one breakdown item, from that item's own real orders only.
 * Returns null (never a fabricated 0% or +100%) when:
 *  - there are fewer than MIN_ORDERS_FOR_GROWTH_PCT real orders combined
 *    across both windows (too little evidence), or
 *  - the prior window's value is exactly 0 — unlike this module's own
 *    company-wide computeGrowthRate (which treats a $0 -> something jump as
 *    a flat +100%, an unambiguous "went from nothing to something" signal at
 *    the WHOLE-COMPANY level with a 6-month history requirement), a
 *    priorValue of 0 at the single product/distributor/territory level with
 *    only a 60-day window is common and usually just means "no orders landed
 *    in the prior window," not a genuine zero-to-something growth story.
 *    Inventing +100% for every zero-history item here would flood the
 *    Growth Opportunities panel with meaningless entries.
 * Rounded to 1 decimal place.
 */
export function computeBreakdownItemGrowthPct(itemOrders: { date: Date; orderValue: number }[], now: Date): number | null {
  const { recentCount, recentValue, priorCount, priorValue } = computeWindowComparison(itemOrders, now, BREAKDOWN_GROWTH_WINDOW_DAYS);
  if (recentCount + priorCount < MIN_ORDERS_FOR_GROWTH_PCT) return null;
  if (priorValue === 0) return null;
  return Math.round(((recentValue - priorValue) / priorValue) * 1000) / 10;
}

/**
 * Attaches growthPct to every item in a breakdown list by filtering the
 * full/pre-filtered order set down to each item's own orders (matching on
 * `field`). O(items * orders) — fine at TOP_BREAKDOWN_LIMIT (8) items.
 */
export function attachGrowthPct(items: RevenueBreakdownItem[], orders: BreakdownSourceOrder[], field: BreakdownField, now: Date): RevenueBreakdownItem[] {
  return items.map((item) => {
    const itemOrders = orders.filter((o) => o[field] === item.id).map((o) => ({ date: o.date, orderValue: o.orderValue }));
    return { ...item, growthPct: computeBreakdownItemGrowthPct(itemOrders, now) };
  });
}

async function computeStateBreakdown(deps: RevenueAnalyticsPrismaDeps, companyId: string): Promise<RevenueBreakdownItem[]> {
  const rows = await groupSalesByField(deps, companyId, "stateId");
  if (rows.length === 0) return [];
  const states = await deps.state.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, name: true } });
  const nameById = new Map((states as any[]).map((s) => [s.id as string, s.name as string]));
  return toBreakdownItems(rows, nameById);
}

async function computeIndustryBreakdown(deps: RevenueAnalyticsPrismaDeps, companyId: string): Promise<RevenueBreakdownItem[]> {
  const rows = await groupSalesByField(deps, companyId, "industryId");
  if (rows.length === 0) return [];
  const industries = await deps.industry.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, name: true } });
  const nameById = new Map((industries as any[]).map((i) => [i.id as string, i.name as string]));
  return toBreakdownItems(rows, nameById);
}

async function computeProductBreakdown(deps: RevenueAnalyticsPrismaDeps, companyId: string): Promise<RevenueBreakdownItem[]> {
  const rows = await groupSalesByField(deps, companyId, "productId");
  if (rows.length === 0) return [];
  const products = await deps.product.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, name: true } });
  const nameById = new Map((products as any[]).map((p) => [p.id as string, p.name as string]));
  return toBreakdownItems(rows, nameById);
}

async function computeSalespersonBreakdown(deps: RevenueAnalyticsPrismaDeps, companyId: string): Promise<RevenueBreakdownItem[]> {
  const rows = await groupSalesByField(deps, companyId, "salespersonId");
  if (rows.length === 0) return [];
  const users = await deps.user.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, name: true } });
  const nameById = new Map((users as any[]).map((u) => [u.id as string, u.name as string]));
  return toBreakdownItems(rows, nameById);
}

/** New for the Phase 10 dashboard redesign — mirrors computeProductBreakdown exactly, resolving real Distributor.name. */
async function computeDistributorBreakdown(deps: RevenueAnalyticsPrismaDeps, companyId: string): Promise<RevenueBreakdownItem[]> {
  const rows = await groupSalesByField(deps, companyId, "distributorId");
  if (rows.length === 0) return [];
  const distributors = await deps.distributor.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, name: true } });
  const nameById = new Map((distributors as any[]).map((d) => [d.id as string, d.name as string]));
  return toBreakdownItems(rows, nameById);
}

/* -------------------------------------------------------------------------
 * Always-hedged, real-evidence-only rule-based narrative — never claims an
 * external cause for growth/decline, and hedges the forecast explicitly as
 * a statistical projection, not a guarantee. Mirrors market-expansion.
 * service.ts's buildRuleBasedNarrative exactly in spirit.
 * ---------------------------------------------------------------------- */

function formatINR(value: string): string {
  return `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;
}

function buildRuleBasedNarrative(evidence: RevenueAnalyticsEvidence): string {
  const bits: string[] = [
    `This company has ${evidence.monthsOfHistory} real month${evidence.monthsOfHistory === 1 ? "" : "s"} of order history on file.`,
  ];

  if (evidence.growthRatePercent.status === "ok") {
    const value = evidence.growthRatePercent.value;
    const direction = value >= 0 ? "up" : "down";
    bits.push(
      `Revenue over the most recent 3 real months is ${direction} ${Math.abs(value)}% compared with the prior 3 real months, based on this company's own recorded orders.`,
    );
  } else {
    bits.push("There isn't yet enough real monthly history (at least 6 months) to compute a reliable growth trend.");
  }

  const topState = evidence.topStates[0];
  if (topState) {
    bits.push(`${topState.name} is this company's strongest real state by recorded revenue so far, at ${formatINR(topState.totalValue)}.`);
  }

  if (evidence.forecast && evidence.forecast.length > 0) {
    bits.push(
      `The next ${evidence.forecast.length} months are shown as a statistical projection based on this company's own historical trend, not a guarantee${evidence.monthsOfHistory < 4 ? " — with only a few real months on file, this projection should be treated as highly uncertain" : ""}.`,
    );
  }

  return bits.join(" ");
}

/* -------------------------------------------------------------------------
 * AI narrative call + validation + retry + fallback — ONE call for the
 * whole company (there is exactly one entity to narrate, unlike Market
 * Expansion's batched per-state list, so there's no id-bijection to check —
 * just shape validation via parseAIRevenueNarrative). Mirrors market-
 * expansion.service.ts's callMarketExpansionAIOnce/
 * runMarketNarrativePipeline structure.
 * ---------------------------------------------------------------------- */

const REVENUE_ANALYTICS_AI_MAX_TOKENS = 1000;

async function callRevenueAnalyticsAIOnce(aiProvider: AIProvider, evidence: RevenueAnalyticsEvidence): Promise<string | null> {
  try {
    const prompt = buildRevenueAnalyticsPrompt(evidence);
    const completion = await aiProvider.generateCompletion(prompt, { maxTokens: REVENUE_ANALYTICS_AI_MAX_TOKENS, temperature: 0.3 });
    const parsed = parseAIRevenueNarrative(completion.content);
    return parsed ? parsed.narrative : null;
  } catch {
    return null;
  }
}

export interface RevenueNarrativePipelineResult {
  /** null only when monthsOfHistory === 0 (nothing to narrate — the AI is never called in that case). */
  narrative: string | null;
  method: ScoreMethod;
}

/**
 * Calls the AI provider once, validates its JSON output, retries once on
 * failure/invalid output, then falls back to the transparent RULE_BASED
 * template — never a silent failure, never a fallback presented as an AI
 * insight. Zero real months of history -> zero AI calls (mirrors
 * market-expansion.service.ts's "zero candidates -> zero AI calls" exact
 * short-circuit, and opportunities.service.ts's precedent for the same).
 */
export async function runRevenueNarrativePipeline(aiProvider: AIProvider, evidence: RevenueAnalyticsEvidence): Promise<RevenueNarrativePipelineResult> {
  if (evidence.monthsOfHistory === 0) {
    return { narrative: null, method: "RULE_BASED" };
  }

  let narrative = await callRevenueAnalyticsAIOnce(aiProvider, evidence);
  if (!narrative) {
    narrative = await callRevenueAnalyticsAIOnce(aiProvider, evidence); // one retry
  }

  if (narrative) {
    return { narrative, method: "AI" };
  }

  return { narrative: buildRuleBasedNarrative(evidence), method: "RULE_BASED" };
}

/* -------------------------------------------------------------------------
 * Generation — gathers real orders + breakdowns + pipeline funnel, computes
 * the monthly series/growth-rate/forecast deterministically, narrates via
 * the AI/fallback pipeline, and assembles the full RevenueAnalyticsDTO.
 * ---------------------------------------------------------------------- */

function toNamedTotals(items: RevenueBreakdownItem[], limit = 3): RevenueAnalyticsNamedTotal[] {
  return items.slice(0, limit).map((i) => ({ name: i.name, totalValue: i.totalValue }));
}

async function generate(deps: RevenueAnalyticsPrismaDeps, aiProvider: AIProvider, companyId: string, now: Date): Promise<{ dto: RevenueAnalyticsDTO; method: ScoreMethod }> {
  const [rawOrders, byStateRaw, byIndustryRaw, byProductRaw, bySalespersonRaw, byDistributorRaw, pipelineFunnel] = await Promise.all([
    // Extended with the FK columns (not just date/orderValue) so the same
    // one query pass can also power per-item growthPct below — no second
    // round trip just to re-fetch the same rows with more columns.
    deps.salesRecord.findMany({
      where: { companyId, cancelledAt: null },
      select: { date: true, orderValue: true, productId: true, stateId: true, industryId: true, salespersonId: true, distributorId: true },
    }),
    computeStateBreakdown(deps, companyId),
    computeIndustryBreakdown(deps, companyId),
    computeProductBreakdown(deps, companyId),
    computeSalespersonBreakdown(deps, companyId),
    computeDistributorBreakdown(deps, companyId),
    computePipelineFunnel(deps, companyId),
  ]);

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
  const byState = attachGrowthPct(byStateRaw, growthOrders, "stateId", now);
  const byIndustry = attachGrowthPct(byIndustryRaw, growthOrders, "industryId", now);
  const byProduct = attachGrowthPct(byProductRaw, growthOrders, "productId", now);
  const bySalesperson = attachGrowthPct(bySalespersonRaw, growthOrders, "salespersonId", now);
  const byDistributor = attachGrowthPct(byDistributorRaw, growthOrders, "distributorId", now);

  const monthly = aggregateMonthlyRevenue(orders);
  const monthsOfHistory = monthly.length;
  const totalRevenueAllTime = orders.reduce((sum, o) => sum + o.orderValue, 0);

  const growthRatePercent = computeGrowthRate(monthly);
  const forecast = computeLinearForecast(monthly, FORECAST_HORIZON_MONTHS);
  const forecastMonths = forecast ? FORECAST_HORIZON_MONTHS : 0;

  const series: RevenueMonthPoint[] = [
    ...monthly.map((m) => ({ monthKey: m.monthKey, revenue: String(Math.round(m.revenue)), orderCount: m.orderCount, kind: "actual" as const })),
    ...(forecast ?? []).map((f) => ({ monthKey: f.monthKey, revenue: String(Math.round(f.revenue)), orderCount: 0, kind: "projected" as const })),
  ];

  const evidence: RevenueAnalyticsEvidence = {
    monthsOfHistory,
    recentMonths: monthly.slice(-6).map((m) => ({ monthKey: m.monthKey, revenue: String(Math.round(m.revenue)) })),
    growthRatePercent,
    topStates: toNamedTotals(byState),
    topIndustries: toNamedTotals(byIndustry),
    topProducts: toNamedTotals(byProduct),
    topSalespeople: toNamedTotals(bySalesperson),
    forecast: forecast ? forecast.map((f) => ({ monthKey: f.monthKey, revenue: String(Math.round(f.revenue)) })) : null,
    pipelineFunnel,
  };

  const { narrative, method } = await runRevenueNarrativePipeline(aiProvider, evidence);

  const dto: RevenueAnalyticsDTO = {
    generatedAt: now.toISOString(),
    series,
    monthsOfHistory,
    forecastMonths,
    growthRatePercent,
    totalRevenueAllTime: String(Math.round(totalRevenueAllTime)),
    byState,
    byIndustry,
    byProduct,
    bySalesperson,
    byDistributor,
    pipelineFunnel,
    narrative,
    narrativeMethod: method,
  };

  return { dto, method };
}

/* -------------------------------------------------------------------------
 * In-memory per-company daily cache. Same shape/tradeoffs as
 * market-expansion.service.ts's cache (a module-level Map, not persisted):
 *  - Lost on every process restart (regenerates lazily on the next request).
 *  - Does not span multiple backend instances if horizontally scaled.
 * ---------------------------------------------------------------------- */

interface CacheEntry {
  dto: RevenueAnalyticsDTO;
  method: ScoreMethod;
  date: string; // YYYY-MM-DD
}

const cache = new Map<string, CacheEntry>();

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Cheap, I/O-free cache peek used by the route layer (mirrors market-expansion.routes.ts's rateLimitIfGenerating pattern exactly). */
export function willRequireGeneration(companyId: string, force: boolean, now: Date = new Date()): boolean {
  if (force) return true;
  const entry = cache.get(companyId);
  return !entry || entry.date !== toDateKey(now);
}

/** Test-only: resets the module-level cache between test cases. */
export function clearRevenueAnalyticsCache(): void {
  cache.clear();
}

async function getOrGenerate(
  deps: RevenueAnalyticsPrismaDeps,
  aiProvider: AIProvider,
  companyId: string,
  force: boolean,
  now: Date,
): Promise<{ entry: CacheEntry; wasGenerated: boolean }> {
  const dateKey = toDateKey(now);
  const cached = !force ? cache.get(companyId) : undefined;
  if (cached && cached.date === dateKey) {
    return { entry: cached, wasGenerated: false };
  }
  const { dto, method } = await generate(deps, aiProvider, companyId, now);
  const entry: CacheEntry = { dto, method, date: dateKey };
  cache.set(companyId, entry);
  return { entry, wasGenerated: true };
}

export interface GetRevenueAnalyticsParams {
  companyId: string;
  force: boolean;
  now?: Date;
}

export interface GetRevenueAnalyticsResult {
  dto: RevenueAnalyticsDTO;
  wasGenerated: boolean;
  method: ScoreMethod;
}

/**
 * Top-level orchestration for GET /revenue-analytics: serves the cached
 * response for today if one exists (unless force=true), otherwise gathers
 * every real order + breakdown + pipeline count, computes the series/
 * growth/forecast deterministically, narrates via the AI/fallback pipeline,
 * caches the full result for the rest of today, and returns the DTO.
 */
export async function getRevenueAnalytics(
  deps: RevenueAnalyticsPrismaDeps,
  aiProvider: AIProvider,
  params: GetRevenueAnalyticsParams,
): Promise<GetRevenueAnalyticsResult> {
  const now = params.now ?? new Date();
  const { entry, wasGenerated } = await getOrGenerate(deps, aiProvider, params.companyId, params.force, now);
  return { dto: entry.dto, wasGenerated, method: entry.method };
}
