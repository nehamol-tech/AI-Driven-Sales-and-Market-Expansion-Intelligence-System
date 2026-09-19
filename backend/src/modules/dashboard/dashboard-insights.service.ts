/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BusinessSignalDTO, DashboardInsightsDTO, DailyPriorityLevel } from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import { getOpportunities } from "../opportunities/opportunities.service.js";
import { OPPORTUNITIES_DEFAULT_LIMIT } from "../opportunities/opportunities.schema.js";
import { getMarketExpansionSummary } from "../market-expansion/market-expansion.service.js";
import { MARKET_EXPANSION_DEFAULT_LIMIT } from "../market-expansion/market-expansion.schema.js";
import { getDistributorExpansionSummary, type DistributorExpansionPrismaDeps } from "../distributors/distributor-expansion.service.js";
import { getAdvertisingAnalytics } from "../advertising/advertising-analytics.service.js";
import { getRevenueAnalytics } from "../revenue-analytics/revenue-analytics.service.js";

/**
 * Narrow, injectable Prisma-like dependency interface — a superset of every
 * sub-source's own deps (OpportunitiesPrismaDeps, MarketExpansionPrismaDeps,
 * DistributorExpansionPrismaDeps, AdvertisingAnalyticsPrismaDeps,
 * RevenueAnalyticsPrismaDeps), same pattern DistributorExpansionPrismaDeps
 * itself already uses to extend MarketExpansionPrismaDeps. A real
 * PrismaClient satisfies this structurally — no adapter needed.
 */
export interface DashboardInsightsPrismaDeps extends DistributorExpansionPrismaDeps {
  account: DistributorExpansionPrismaDeps["account"] & {
    findUnique(args: any): Promise<any | null>;
  };
  salesRecord: DistributorExpansionPrismaDeps["salesRecord"] & {
    aggregate(args: any): Promise<any>;
  };
  prospect: DistributorExpansionPrismaDeps["prospect"] & {
    count(args: any): Promise<number>;
    groupBy(args: any): Promise<any[]>;
  };
  industry: {
    findMany(args: any): Promise<any[]>;
  };
  user: {
    findMany(args: any): Promise<any[]>;
  };
  adCampaign: {
    findMany(args: any): Promise<any[]>;
  };
  adSpendRecord: {
    aggregate(args: any): Promise<any>;
  };
}

/* -------------------------------------------------------------------------
 * This whole module is pure orchestration: it calls five ALREADY-EXISTING
 * top-level functions (getOpportunities / getMarketExpansionSummary /
 * getDistributorExpansionSummary / getAdvertisingAnalytics /
 * getRevenueAnalytics), each of which owns its own independent per-company
 * daily cache + AI-narration pipeline (Phase 3C/4/6/7/8/9). This module
 * itself makes ZERO new AI calls and detects/scores NOTHING new — it only
 * reads each source's already-computed, already-real output and reshapes
 * the qualifying entries into the common BusinessSignalDTO shape for the
 * dashboard's "Problems to Fix" / "Growth Opportunities" panels.
 *
 * Deliberately reuses each source's own DEFAULT_LIMIT (rather than a larger
 * one) for the calls below — a larger limit on a cache-miss would inflate
 * that source's own AI-narration cost/count for the rest of the day for
 * EVERY caller (the daily cache is not re-keyed by limit), which this
 * dashboard-composition feature must never do as a side effect of simply
 * being viewed.
 * ---------------------------------------------------------------------- */

/** |changePct| >= this -> HIGH severity. Only applies to the two signal kinds this module itself scores (advertising ROAS, growth-aware breakdown items) — see the per-source severity note below. */
export const DASHBOARD_INSIGHT_HIGH_SEVERITY_THRESHOLD = 25;
/** |changePct| >= this (and < HIGH) -> MEDIUM severity; below this, the signal is not "noticeable" enough to surface at all. */
export const DASHBOARD_INSIGHT_MEDIUM_SEVERITY_THRESHOLD = 10;
/** Caps each of `problems`/`opportunities` at this many entries — UI/cost control, mirrors TOP_BREAKDOWN_LIMIT's "cap the list, don't fabricate to fill it" precedent. */
export const DASHBOARD_INSIGHT_MAX_PER_LIST = 10;

const SEVERITY_RANK: Record<"HIGH" | "MEDIUM" | "LOW", number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** Deterministic magnitude -> severity for the signals THIS module scores directly (never AI-assigned). Returns null when the magnitude is below the "noticeable" floor — the caller must then drop the candidate entirely rather than include a near-zero signal. */
function severityFromMagnitude(absChangePct: number): "HIGH" | "MEDIUM" | "LOW" | null {
  if (absChangePct >= DASHBOARD_INSIGHT_HIGH_SEVERITY_THRESHOLD) return "HIGH";
  if (absChangePct >= DASHBOARD_INSIGHT_MEDIUM_SEVERITY_THRESHOLD) return "MEDIUM";
  return null;
}

function formatINR(value: number | string): string {
  return `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;
}

/** Extracts the leading real number out of an evidence value string like "45%" or "4 orders" — used only to surface a real, already-computed figure (never invents one). Returns null if the labeled evidence item isn't present. */
function parseEvidenceNumber(evidence: { label: string; value: string }[], label: string): number | null {
  const item = evidence.find((e) => e.label === label);
  if (!item) return null;
  const match = item.value.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

interface RankedCandidate {
  signal: BusinessSignalDTO;
  /** Real, source-specific ranking basis (declinePct/growthPct magnitude, Market Expansion's own score, Distributor Expansion's own opportunityScore, etc.) — never a fabricated tie-break. */
  magnitude: number;
}

function rankAndCap(candidates: RankedCandidate[], limit: number): BusinessSignalDTO[] {
  return candidates
    .sort((a, b) => {
      const severityDiff = SEVERITY_RANK[a.signal.severity] - SEVERITY_RANK[b.signal.severity];
      if (severityDiff !== 0) return -severityDiff; // desc
      return b.magnitude - a.magnitude; // desc
    })
    .slice(0, limit)
    .map((c) => c.signal);
}

/* -------------------------------------------------------------------------
 * Source 1 — Opportunities (Phase 3C). AT_RISK -> problem, CROSS_SELL /
 * GROWING_ACCOUNT -> opportunity. Severity is taken directly from the
 * detector's OWN already-computed `priority` (HIGH/MEDIUM/LOW share the
 * exact same three-value type as BusinessSignalDTO.severity) rather than
 * re-derived from a generic |changePct| threshold — AT_RISK/GROWING_ACCOUNT's
 * priority already reflects a real, documented, evidence-specific threshold
 * (detectors.ts's AT_RISK_PRIORITY_HIGH_DECLINE / GROWING_PRIORITY_HIGH_GROWTH),
 * and CROSS_SELL has no percentage at all to threshold against. Re-deriving
 * severity generically here would either conflict with or discard that
 * existing, already-correct judgment.
 * ---------------------------------------------------------------------- */

function accountSignalFromOpportunity(o: {
  id: string;
  type: string;
  leadId: string;
  name: string;
  priority: DailyPriorityLevel;
  evidence: { label: string; value: string }[];
  recommendedAction: string;
}): RankedCandidate {
  const isDecline = o.type === "AT_RISK";
  const magnitudeLabel = isDecline ? "Decline" : o.type === "GROWING_ACCOUNT" ? "Growth" : "Orders of owned product";
  const parsed = parseEvidenceNumber(o.evidence, magnitudeLabel);
  const changePct = parsed === null ? null : isDecline ? -parsed : o.type === "GROWING_ACCOUNT" ? parsed : null;

  const subtitle =
    o.type === "AT_RISK"
      ? "Order activity has genuinely declined over the last 60 days versus the prior 60."
      : o.type === "GROWING_ACCOUNT"
        ? "Order activity has genuinely grown over the last 60 days versus the prior 60."
        : "Repeat purchase pattern matches a real cross-sell candidate.";

  return {
    signal: {
      id: `account-${o.id}`,
      category: "ACCOUNT",
      title: o.name,
      subtitle,
      currentValue: null,
      previousValue: null,
      changePct,
      severity: o.priority,
      evidence: o.evidence,
      recommendedAction: o.recommendedAction,
      // A real, existing per-account detail route.
      detailHref: `/leads/accounts/${o.leadId}`,
    },
    magnitude: parsed ?? 0,
  };
}

/* -------------------------------------------------------------------------
 * Source 2 — Market Expansion (Phase 4). Top HIGH_OPPORTUNITY/
 * MEDIUM_OPPORTUNITY states -> opportunity, category TERRITORY. Severity from
 * the state's own already-computed classification (same reasoning as
 * Source 1: a real, deterministic, evidence-based judgment already exists —
 * MarketSummaryDTO carries no percent-change figure to threshold against, so
 * re-deriving generically isn't possible or appropriate here).
 * ---------------------------------------------------------------------- */

function territorySignalFromMarket(m: {
  stateId: string;
  stateName: string;
  classification: string;
  score: number | null;
  narrative: string | null;
  evidence: { label: string; value: string }[];
}): RankedCandidate | null {
  const severity = m.classification === "HIGH_OPPORTUNITY" ? "HIGH" : m.classification === "MEDIUM_OPPORTUNITY" ? "MEDIUM" : null;
  if (!severity) return null;

  return {
    signal: {
      id: `territory-market-${m.stateId}`,
      category: "TERRITORY",
      title: m.stateName,
      subtitle: "Strong internal demand signal in this state (Market Expansion's own scoring, not external market data).",
      currentValue: m.score !== null ? `Score ${m.score}/100` : null,
      previousValue: null,
      // No percent-change figure exists on MarketSummaryDTO (score is an absolute 0-100 opportunity score, not a period-over-period change) — honestly null rather than a fabricated percentage.
      changePct: null,
      severity,
      evidence: m.evidence,
      recommendedAction: m.narrative ?? `Consider prioritizing ${m.stateName} for expansion.`,
      detailHref: `/market-expansion/${m.stateId}`,
    },
    magnitude: m.score ?? 0,
  };
}

/* -------------------------------------------------------------------------
 * Source 3 — Distributor Expansion (Phase 8) coverage-gap recommendations.
 * A real HIGH/MEDIUM opportunity state with ZERO real distributor coverage
 * -> opportunity, category DISTRIBUTOR (the gap IS a distributor-network
 * gap, distinct from Market Expansion's own state-level signal above, even
 * though both key off the same state). Severity from the recommendation's
 * own classification, same reasoning as Source 2.
 * ---------------------------------------------------------------------- */

function distributorGapSignal(r: { stateId: string; stateName: string; opportunityScore: number; opportunityClassification: string }): RankedCandidate | null {
  const severity = r.opportunityClassification === "HIGH_OPPORTUNITY" ? "HIGH" : r.opportunityClassification === "MEDIUM_OPPORTUNITY" ? "MEDIUM" : null;
  if (!severity) return null;

  return {
    signal: {
      id: `distributor-gap-${r.stateId}`,
      category: "DISTRIBUTOR",
      title: `${r.stateName} has zero distributor coverage`,
      subtitle: "A real internal demand signal with no active distributor assigned to this state.",
      currentValue: "0 distributors",
      previousValue: null,
      changePct: null,
      severity,
      evidence: [{ label: "Opportunity score", value: `${r.opportunityScore}/100` }],
      recommendedAction: `Recruit or assign a distributor to cover ${r.stateName}.`,
      detailHref: "/distributors",
    },
    magnitude: r.opportunityScore,
  };
}

/* -------------------------------------------------------------------------
 * Source 4 — Advertising Analytics (Phase 9). Active campaigns with a known
 * ROAS below 1.0x (spending more than the attributed revenue they generate)
 * -> problem, category CAMPAIGN. Unlike Sources 1-3, this IS a signal this
 * module scores itself: changePct is a real derived figure ((roas - 1) *
 * 100 — percent below/above the 1.0x breakeven line), so the generic
 * |changePct| threshold applies.
 * ---------------------------------------------------------------------- */

function campaignSignal(c: { campaignId: string; campaignName: string; totalSpend: string; roas: { status: string; value?: number } }): RankedCandidate | null {
  if (c.roas.status !== "ok" || c.roas.value === undefined || c.roas.value >= 1) return null;
  const changePct = Math.round((c.roas.value - 1) * 1000) / 10;
  const severity = severityFromMagnitude(Math.abs(changePct));
  if (!severity) return null;

  return {
    signal: {
      id: `campaign-${c.campaignId}`,
      category: "CAMPAIGN",
      title: c.campaignName,
      subtitle: "Real return on ad spend is below breakeven (won leads matched to a real account with recorded revenue).",
      currentValue: `${c.roas.value.toFixed(2)}x ROAS`,
      previousValue: "1.00x (breakeven)",
      changePct,
      severity,
      evidence: [
        { label: "Total spend", value: formatINR(c.totalSpend) },
        { label: "ROAS", value: `${c.roas.value.toFixed(2)}x` },
      ],
      recommendedAction: "Review targeting/creative or reduce spend on this campaign — its real recorded return is below breakeven.",
      detailHref: "/advertising",
    },
    magnitude: Math.abs(changePct),
  };
}

/* -------------------------------------------------------------------------
 * Source 5 — Part 1's growth-aware revenue breakdowns (byProduct/byState/
 * byDistributor from revenue-analytics.service.ts's getRevenueAnalytics).
 * A real 60-day growthPct <= -MEDIUM threshold -> problem; >= +MEDIUM ->
 * opportunity. This IS a signal this module scores itself (changePct is
 * exactly item.growthPct, no re-derivation needed), so the generic
 * |changePct| threshold applies directly.
 * ---------------------------------------------------------------------- */

function breakdownSignal(
  item: { id: string; name: string; totalValue: string; orderCount: number; growthPct?: number | null },
  category: "PRODUCT" | "TERRITORY" | "DISTRIBUTOR",
  detailHref: string | null,
): RankedCandidate | null {
  if (item.growthPct === undefined || item.growthPct === null) return null;
  const severity = severityFromMagnitude(Math.abs(item.growthPct));
  if (!severity) return null;

  const direction = item.growthPct < 0 ? "declined" : "grown";
  return {
    signal: {
      id: `${category.toLowerCase()}-growth-${item.id}`,
      category,
      title: item.name,
      subtitle: `Order value has ${direction} ${Math.abs(item.growthPct)}% over the last 60 real days versus the prior 60 (all-time total shown below).`,
      currentValue: formatINR(item.totalValue),
      previousValue: null,
      changePct: item.growthPct,
      severity,
      evidence: [
        { label: "All-time order value", value: formatINR(item.totalValue) },
        { label: "All-time order count", value: `${item.orderCount}` },
        { label: "60-day change", value: `${item.growthPct}%` },
      ],
      recommendedAction:
        item.growthPct < 0
          ? `Investigate the recent drop-off for ${item.name} — order value is down ${Math.abs(item.growthPct)}% over the last 60 days.`
          : `${item.name} is growing — consider prioritizing supply/coverage for it.`,
      detailHref,
    },
    magnitude: Math.abs(item.growthPct),
  };
}

/**
 * Top-level orchestration for GET /api/dashboard/insights: composes real,
 * already-computed output from every phase's own detection/scoring engine
 * into the dashboard's Problems/Opportunities panels. Zero new AI calls,
 * zero new detection logic. If literally nothing qualifies anywhere, returns
 * `{ problems: [], opportunities: [] }` — never a fabricated filler entry.
 */
export async function getDashboardInsights(deps: DashboardInsightsPrismaDeps, aiProvider: AIProvider, companyId: string, now: Date = new Date()): Promise<DashboardInsightsDTO> {
  const [opportunitiesResult, marketResult, distributorResult, advertisingResult, revenueResult] = await Promise.all([
    getOpportunities(deps, aiProvider, { companyId, limit: OPPORTUNITIES_DEFAULT_LIMIT, force: false, now }),
    getMarketExpansionSummary(deps, aiProvider, { companyId, limit: MARKET_EXPANSION_DEFAULT_LIMIT, force: false, now }),
    getDistributorExpansionSummary(deps, aiProvider, { companyId, force: false, now }),
    getAdvertisingAnalytics(deps, aiProvider, { companyId, force: false, now }),
    getRevenueAnalytics(deps, aiProvider, { companyId, force: false, now }),
  ]);

  const problemCandidates: RankedCandidate[] = [];
  const opportunityCandidates: RankedCandidate[] = [];

  for (const o of opportunitiesResult.dto.opportunities) {
    if (o.type === "AT_RISK") {
      problemCandidates.push(accountSignalFromOpportunity(o));
    } else if (o.type === "CROSS_SELL" || o.type === "GROWING_ACCOUNT") {
      opportunityCandidates.push(accountSignalFromOpportunity(o));
    }
  }

  for (const m of marketResult.dto.markets) {
    const candidate = territorySignalFromMarket(m);
    if (candidate) opportunityCandidates.push(candidate);
  }

  for (const r of distributorResult.recommendations) {
    const candidate = distributorGapSignal(r);
    if (candidate) opportunityCandidates.push(candidate);
  }

  for (const c of advertisingResult.campaigns) {
    const candidate = campaignSignal(c);
    if (candidate) problemCandidates.push(candidate);
  }

  for (const item of revenueResult.dto.byProduct) {
    const candidate = breakdownSignal(item, "PRODUCT", "/products");
    if (candidate) (candidate.signal.changePct! < 0 ? problemCandidates : opportunityCandidates).push(candidate);
  }
  for (const item of revenueResult.dto.byState) {
    const candidate = breakdownSignal(item, "TERRITORY", `/market-expansion/${item.id}`);
    if (candidate) (candidate.signal.changePct! < 0 ? problemCandidates : opportunityCandidates).push(candidate);
  }
  for (const item of revenueResult.dto.byDistributor) {
    const candidate = breakdownSignal(item, "DISTRIBUTOR", "/distributors");
    if (candidate) (candidate.signal.changePct! < 0 ? problemCandidates : opportunityCandidates).push(candidate);
  }

  return {
    problems: rankAndCap(problemCandidates, DASHBOARD_INSIGHT_MAX_PER_LIST),
    opportunities: rankAndCap(opportunityCandidates, DASHBOARD_INSIGHT_MAX_PER_LIST),
  };
}
