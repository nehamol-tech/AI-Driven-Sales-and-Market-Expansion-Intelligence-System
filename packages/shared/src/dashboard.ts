import type { RevenueBreakdownItem, RevenueMonthPoint } from "./revenue-analytics.js";

/**
 * One real, deterministically-detected business signal for the redesigned
 * dashboard's "Problems to Fix" / "Growth Opportunities" panels. Every field
 * is computed from an already-detected/already-cached source (Opportunities,
 * Market Expansion, Distributor Expansion, Advertising Analytics, or the
 * growth-aware revenue breakdowns) — dashboard-insights.service.ts makes
 * zero new AI calls and never invents a signal.
 */
export interface BusinessSignalDTO {
  id: string;
  category: "PRODUCT" | "DISTRIBUTOR" | "TERRITORY" | "ACCOUNT" | "CAMPAIGN";
  title: string;
  subtitle: string;
  currentValue: string | null;
  previousValue: string | null;
  changePct: number | null;
  severity: "HIGH" | "MEDIUM" | "LOW";
  evidence: { label: string; value: string }[];
  recommendedAction: string;
  /** A real, existing frontend route, or null when no sensible existing destination exists — never a guessed URL. */
  detailHref: string | null;
}

export interface DashboardInsightsDTO {
  problems: BusinessSignalDTO[];
  opportunities: BusinessSignalDTO[];
}

/**
 * One filtered view of Sales Trend + Top Products + Distributor Performance,
 * all driven by the SAME filtered SalesRecord set — powers the redesigned
 * dashboard's filter controls with a single backend call. `series` reuses
 * RevenueMonthPoint verbatim, always `kind: "actual"` (this is a historical
 * filtered view, not Phase 6's forecast feature).
 */
export interface SalesTrendDTO {
  series: RevenueMonthPoint[];
  monthsOfHistory: number;
  totalForFilteredRange: string;
  orderCountForFilteredRange: number;
  topProducts: RevenueBreakdownItem[];
  distributorPerformance: RevenueBreakdownItem[];
}
