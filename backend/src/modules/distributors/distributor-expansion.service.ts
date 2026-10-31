/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DistributorPerformanceDTO, DistributorType, ExpansionRecommendationDTO, ScoreMethod } from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import { gatherStateProfiles, type MarketExpansionPrismaDeps } from "../market-expansion/state-profile.service.js";
import { computeMaxTotalSalesValueAcrossStatesWithOrders, scoreState } from "../market-expansion/market-scoring.js";
import { buildDistributorExpansionPrompt, type DistributorExpansionEvidence } from "./distributor-expansion.prompt.js";
import { parseAIDistributorExpansionNarrative } from "./distributor-expansion.schema.js";

/**
 * Narrow, injectable Prisma-like dependency interface — a superset of
 * MarketExpansionPrismaDeps (this module calls gatherStateProfiles/scoreState
 * directly, reusing Phase 4's scoring engine unchanged) plus this feature's
 * own distributor/territory/sales needs. A real PrismaClient satisfies this
 * structurally — no adapter needed.
 */
export interface DistributorExpansionPrismaDeps extends MarketExpansionPrismaDeps {
  distributor: {
    findMany(args: any): Promise<any[]>;
  };
  distributorTerritory: {
    findMany(args: any): Promise<any[]>;
  };
  salesRecord: MarketExpansionPrismaDeps["salesRecord"] & {
    groupBy(args: any): Promise<any[]>;
  };
}

/** Caps how many top-ranked zero-coverage opportunity states are returned as recommendations — cost/UI control, mirrors MARKET_EXPANSION_DEFAULT_LIMIT's pattern. */
export const EXPANSION_RECOMMENDATION_LIMIT = 10;

/**
 * Real per-state ACTIVE-distributor coverage count, from actual
 * DistributorTerritory rows joined to an ACTIVE Distributor. States with zero
 * such rows are simply absent from the returned map (callers treat a missing
 * entry as 0) — never fabricated, never omitted from the final recommendation
 * set itself.
 */
async function computeCoverageCountByState(deps: DistributorExpansionPrismaDeps, companyId: string): Promise<Map<string, number>> {
  const territories = await deps.distributorTerritory.findMany({
    where: { distributor: { companyId, status: "ACTIVE" } },
    select: { stateId: true },
  });

  const coverageByState = new Map<string, number>();
  for (const t of territories as { stateId: string }[]) {
    coverageByState.set(t.stateId, (coverageByState.get(t.stateId) ?? 0) + 1);
  }
  return coverageByState;
}

/**
 * Reuses Phase 4's gatherStateProfiles/scoreState/
 * computeMaxTotalSalesValueAcrossStatesWithOrders directly — this feature
 * never re-derives or duplicates any part of the opportunity-scoring engine.
 * Filters to states with a real HIGH_OPPORTUNITY/MEDIUM_OPPORTUNITY
 * classification AND zero real ACTIVE-distributor coverage, ranks by score
 * desc, caps at EXPANSION_RECOMMENDATION_LIMIT. Zero qualifying states ->
 * empty array (never fabricated to fill the list).
 */
export async function computeExpansionRecommendations(
  deps: DistributorExpansionPrismaDeps,
  companyId: string,
  now: Date,
): Promise<ExpansionRecommendationDTO[]> {
  const [{ profiles, products }, coverageByState] = await Promise.all([
    gatherStateProfiles(deps, companyId),
    computeCoverageCountByState(deps, companyId),
  ]);

  const totalActiveProductCount = products.length;
  const maxTotalSalesValueAcrossStatesWithOrders = computeMaxTotalSalesValueAcrossStatesWithOrders(profiles);

  const candidates: ExpansionRecommendationDTO[] = [];
  for (const profile of profiles) {
    const result = scoreState(profile, { now, maxTotalSalesValueAcrossStatesWithOrders, totalActiveProductCount, products });
    if (result.classification !== "HIGH_OPPORTUNITY" && result.classification !== "MEDIUM_OPPORTUNITY") continue;

    const coverageCount = coverageByState.get(profile.stateId) ?? 0;
    if (coverageCount !== 0) continue;

    candidates.push({
      stateId: profile.stateId,
      stateName: profile.stateName,
      opportunityScore: result.score ?? 0, // never null here: HIGH/MEDIUM_OPPORTUNITY always carries a real score
      opportunityClassification: result.classification,
      distributorCoverageCount: 0,
    });
  }

  candidates.sort((a, b) => b.opportunityScore - a.opportunityScore);
  return candidates.slice(0, EXPANSION_RECOMMENDATION_LIMIT);
}

/**
 * Every real Distributor on file, with real totalRevenue/orderCount summed
 * from its linked SalesRecords via one batched groupBy (rather than N
 * per-distributor aggregate calls). These are plain, always-fully-known
 * numbers (never MetricValue) — a distributor with zero linked sales still
 * appears with totalRevenue: "0", orderCount: 0, never omitted (mirrors
 * dashboard.service.ts's "a COUNT is always known, even at zero" precedent).
 */
export async function computeDistributorPerformance(deps: DistributorExpansionPrismaDeps, companyId: string): Promise<DistributorPerformanceDTO[]> {
  const distributors = await deps.distributor.findMany({
    where: { companyId },
    select: { id: true, name: true, type: true },
    orderBy: { createdAt: "desc" },
  });

  if (distributors.length === 0) return [];

  const distributorIds = (distributors as { id: string }[]).map((d) => d.id);
  const grouped = await deps.salesRecord.groupBy({
    by: ["distributorId"],
    where: { companyId, distributorId: { in: distributorIds }, cancelledAt: null },
    _sum: { orderValue: true },
    _count: { _all: true },
  });

  const statsByDistributor = new Map<string, { revenue: number; count: number }>();
  for (const g of grouped as any[]) {
    if (!g.distributorId) continue;
    statsByDistributor.set(g.distributorId, {
      revenue: Number(g._sum?.orderValue ?? 0),
      count: Number(g._count?._all ?? 0),
    });
  }

  return (distributors as { id: string; name: string; type: DistributorType }[]).map((d) => {
    const stats = statsByDistributor.get(d.id) ?? { revenue: 0, count: 0 };
    return {
      distributorId: d.id,
      name: d.name,
      type: d.type,
      totalRevenue: String(Math.round(stats.revenue)),
      orderCount: stats.count,
    };
  });
}

/* -------------------------------------------------------------------------
 * Always-hedged, real-evidence-only rule-based narrative — mirrors
 * advertising-analytics.service.ts's buildRuleBasedNarrative exactly in
 * spirit.
 * ---------------------------------------------------------------------- */

function buildRuleBasedNarrative(evidence: DistributorExpansionEvidence): string {
  const bits: string[] = [];

  if (evidence.recommendations.length > 0) {
    const top = evidence.recommendations[0];
    const classificationLabel = top.opportunityClassification.replace(/_/g, " ").toLowerCase();
    bits.push(
      `${evidence.recommendations.length} real state${evidence.recommendations.length === 1 ? "" : "s"} show${evidence.recommendations.length === 1 ? "s" : ""} a real internal demand signal (based on this company's own market-expansion scoring) with zero distributor coverage today; the strongest is ${top.stateName}, classified as ${classificationLabel} internally.`,
    );
  } else {
    bits.push("No real state currently combines a high or medium internal opportunity signal with zero distributor coverage.");
  }

  if (evidence.performance.length > 0) {
    const withRevenue = evidence.performance.filter((p) => Number(p.totalRevenue) > 0);
    if (withRevenue.length > 0) {
      const best = withRevenue.reduce((a, b) => (Number(a.totalRevenue) >= Number(b.totalRevenue) ? a : b));
      bits.push(`${best.name} is your top-performing distributor by real recorded revenue so far, with ${best.orderCount} real order${best.orderCount === 1 ? "" : "s"} on file.`);
    } else {
      bits.push(`${evidence.performance.length} real distributor${evidence.performance.length === 1 ? "" : "s"} on file, but none has any recorded revenue yet.`);
    }
  } else {
    bits.push("No distributor is on file yet.");
  }

  return bits.join(" ");
}

/* -------------------------------------------------------------------------
 * AI narrative call + validation + retry + fallback — mirrors
 * advertising-analytics.service.ts's callAdvertisingAnalyticsAIOnce/
 * runAdvertisingNarrativePipeline structure exactly.
 * ---------------------------------------------------------------------- */

const DISTRIBUTOR_EXPANSION_AI_MAX_TOKENS = 1000;

async function callDistributorExpansionAIOnce(aiProvider: AIProvider, evidence: DistributorExpansionEvidence): Promise<string | null> {
  try {
    const prompt = buildDistributorExpansionPrompt(evidence);
    const completion = await aiProvider.generateCompletion(prompt, { maxTokens: DISTRIBUTOR_EXPANSION_AI_MAX_TOKENS, temperature: 0.3 });
    const parsed = parseAIDistributorExpansionNarrative(completion.content);
    return parsed ? parsed.narrative : null;
  } catch {
    return null;
  }
}

export interface DistributorExpansionNarrativePipelineResult {
  /** null only when there are zero recommendations AND zero distributors to narrate (the AI is never called in that case). */
  narrative: string | null;
  method: ScoreMethod;
}

/**
 * Calls the AI provider once, validates its JSON output, retries once on
 * failure/invalid output, then falls back to the transparent RULE_BASED
 * template — never a silent failure. Zero recommendations AND zero
 * distributors -> zero AI calls.
 */
export async function runDistributorExpansionNarrativePipeline(
  aiProvider: AIProvider,
  evidence: DistributorExpansionEvidence,
): Promise<DistributorExpansionNarrativePipelineResult> {
  if (evidence.recommendations.length === 0 && evidence.performance.length === 0) {
    return { narrative: null, method: "RULE_BASED" };
  }

  let narrative = await callDistributorExpansionAIOnce(aiProvider, evidence);
  if (!narrative) {
    narrative = await callDistributorExpansionAIOnce(aiProvider, evidence); // one retry
  }

  if (narrative) {
    return { narrative, method: "AI" };
  }

  return { narrative: buildRuleBasedNarrative(evidence), method: "RULE_BASED" };
}

/* -------------------------------------------------------------------------
 * Generation — computes real recommendations + real distributor performance,
 * narrates via the AI/fallback pipeline.
 * ---------------------------------------------------------------------- */

async function generate(
  deps: DistributorExpansionPrismaDeps,
  aiProvider: AIProvider,
  companyId: string,
  now: Date,
): Promise<{ recommendations: ExpansionRecommendationDTO[]; performance: DistributorPerformanceDTO[]; narrative: string | null; method: ScoreMethod }> {
  const [recommendations, performance] = await Promise.all([
    computeExpansionRecommendations(deps, companyId, now),
    computeDistributorPerformance(deps, companyId),
  ]);

  const evidence: DistributorExpansionEvidence = { recommendations, performance };
  const { narrative, method } = await runDistributorExpansionNarrativePipeline(aiProvider, evidence);

  return { recommendations, performance, narrative, method };
}

/* -------------------------------------------------------------------------
 * In-memory per-company daily cache — same shape/tradeoffs as
 * advertising-analytics.service.ts's cache.
 * ---------------------------------------------------------------------- */

interface CacheEntry {
  recommendations: ExpansionRecommendationDTO[];
  performance: DistributorPerformanceDTO[];
  narrative: string | null;
  method: ScoreMethod;
  date: string; // YYYY-MM-DD
}

const cache = new Map<string, CacheEntry>();

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Cheap, I/O-free cache peek used by the route layer (mirrors advertising-analytics.routes.ts's rateLimitIfGenerating pattern exactly). */
export function willRequireGeneration(companyId: string, force: boolean, now: Date = new Date()): boolean {
  if (force) return true;
  const entry = cache.get(companyId);
  return !entry || entry.date !== toDateKey(now);
}

/** Test-only: resets the module-level cache between test cases. */
export function clearDistributorExpansionCache(): void {
  cache.clear();
}

async function getOrGenerate(
  deps: DistributorExpansionPrismaDeps,
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
  const { recommendations, performance, narrative, method } = await generate(deps, aiProvider, companyId, now);
  const entry: CacheEntry = { recommendations, performance, narrative, method, date: dateKey };
  cache.set(companyId, entry);
  return { entry, wasGenerated: true };
}

export interface GetDistributorExpansionSummaryParams {
  companyId: string;
  force: boolean;
  now?: Date;
}

export interface GetDistributorExpansionSummaryResult {
  recommendations: ExpansionRecommendationDTO[];
  performance: DistributorPerformanceDTO[];
  narrative: string | null;
  narrativeMethod: ScoreMethod;
  wasGenerated: boolean;
}

/**
 * Top-level orchestration for GET /api/distributors/expansion: serves the
 * cached recommendations+performance+narrative for today if present (unless
 * force=true), otherwise recomputes real state opportunity/coverage and real
 * distributor performance, narrates via the AI/fallback pipeline, caches the
 * result for the rest of today.
 */
export async function getDistributorExpansionSummary(
  deps: DistributorExpansionPrismaDeps,
  aiProvider: AIProvider,
  params: GetDistributorExpansionSummaryParams,
): Promise<GetDistributorExpansionSummaryResult> {
  const now = params.now ?? new Date();
  const { entry, wasGenerated } = await getOrGenerate(deps, aiProvider, params.companyId, params.force, now);
  return {
    recommendations: entry.recommendations,
    performance: entry.performance,
    narrative: entry.narrative,
    narrativeMethod: entry.method,
    wasGenerated,
  };
}
