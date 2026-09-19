import type { ProspectStatus } from "./leads.js";
import type { ScoreMethod } from "./leads.js";
import type { MetricValue } from "./types.js";

export interface RevenueMonthPoint {
  monthKey: string; // "YYYY-MM"
  revenue: string; // real Decimal->string, "0" for a projected point uses the forecast value
  orderCount: number; // 0 for projected points — there is no real order count for the future
  kind: "actual" | "projected";
}

export interface RevenueBreakdownItem {
  id: string;
  name: string;
  totalValue: string;
  orderCount: number;
  /**
   * Percent change in this single item's own order value, most-recent 60
   * real days vs the prior 60 real days (same window detectAtRisk/
   * detectGrowingAccount use), rounded to 1 decimal place. `null` — not a
   * fabricated 0 or +100 — whenever there isn't a meaningful basis for a
   * percentage: either the prior 60-day window has $0 in it (common for a
   * single product/distributor/territory and usually just means "no data in
   * that window," not a genuine zero-to-something growth story), or there
   * are too few real orders across both windows to trust the comparison.
   * Optional so every existing consumer of this type (built before this
   * field existed) keeps compiling unchanged.
   */
  growthPct?: number | null;
}

export interface PipelineFunnelStageDTO {
  status: ProspectStatus;
  count: number;
}

export interface RevenueAnalyticsDTO {
  generatedAt: string;
  series: RevenueMonthPoint[]; // real months ascending, then `forecastMonths` projected points appended (empty forecast tail if insufficient data)
  monthsOfHistory: number; // count of real months with at least one order
  forecastMonths: number; // 0 if insufficient data, else FORECAST_HORIZON_MONTHS
  growthRatePercent: MetricValue<number>;
  totalRevenueAllTime: string;
  byState: RevenueBreakdownItem[];
  byIndustry: RevenueBreakdownItem[];
  byProduct: RevenueBreakdownItem[];
  bySalesperson: RevenueBreakdownItem[];
  byDistributor: RevenueBreakdownItem[];
  pipelineFunnel: PipelineFunnelStageDTO[]; // one entry per PROSPECT_STATUSES value, in that order, including zero counts
  narrative: string | null; // null only when monthsOfHistory === 0 (nothing to narrate)
  narrativeMethod: ScoreMethod;
}
