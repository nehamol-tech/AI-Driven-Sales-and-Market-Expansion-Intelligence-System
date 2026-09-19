import type {
  MarketDetailDTO,
  MarketExpansionSummaryDTO,
  MarketExpansionHypothesis,
  MarketSummaryDTO,
  OpportunityEvidenceItem,
  ScoreMethod,
} from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import {
  gatherStateProfiles,
  type MarketExpansionPrismaDeps,
  type StateProfile,
} from "./state-profile.service.js";
import {
  computeExpansionHypothesisCandidates,
  buildRuleBasedHypothesisStatement,
  type ExpansionHypothesisCandidate,
} from "./expansion-signals.js";
import {
  scoreState,
  computeMaxTotalSalesValueAcrossStatesWithOrders,
  type MarketScoreResult,
} from "./market-scoring.js";
import { buildMarketExpansionPrompt, type MarketNarrationCandidate } from "./market-expansion.prompt.js";
import { parseAIMarketExpansionResponse, MARKET_EXPANSION_DEFAULT_LIMIT } from "./market-expansion.schema.js";

export type { MarketExpansionPrismaDeps } from "./state-profile.service.js";

function formatINR(value: number): string {
  return Math.round(value).toLocaleString("en-IN");
}

/* -------------------------------------------------------------------------
 * Real, computed evidence — the same real fields shown to the AI and
 * presented verbatim in the DTO. Never AI text.
 * ---------------------------------------------------------------------- */

function buildEvidence(profile: StateProfile): OpportunityEvidenceItem[] {
  const items: OpportunityEvidenceItem[] = [
    { label: "Accounts", value: `${profile.accountCount}` },
    { label: "Prospects", value: `${profile.prospectCount}` },
    { label: "Orders", value: `${profile.orderCount}` },
  ];
  if (profile.orderCount > 0) {
    items.push({ label: "Total sales value", value: `₹${formatINR(profile.totalSalesValue)}` });
    if (profile.averageOrderValue !== null) {
      items.push({ label: "Average order value", value: `₹${formatINR(profile.averageOrderValue)}` });
    }
  }
  if (profile.accountCount > 0) {
    items.push({ label: "Hot / warm accounts", value: `${profile.hotAccountCount} hot, ${profile.warmAccountCount} warm` });
  }
  if (profile.topIndustry) {
    items.push({ label: "Top industry", value: `${profile.topIndustry.industryName} (₹${formatINR(profile.topIndustry.totalValue)})` });
  }
  return items;
}

/** Always-hedged, real-evidence-only rule-based narrative — never claims external demand. */
function buildRuleBasedNarrative(profile: StateProfile, result: MarketScoreResult): string {
  if (result.classification === "INSUFFICIENT_DATA") {
    return `${profile.stateName} has no real accounts, prospects, or orders on file yet, so there isn't enough internal data to assess it.`;
  }

  const bits: string[] = [
    `${profile.stateName} has ${profile.accountCount} account${profile.accountCount === 1 ? "" : "s"} and ${profile.prospectCount} prospect${profile.prospectCount === 1 ? "" : "s"} on file`,
  ];
  if (profile.orderCount > 0) {
    bits.push(`with ${profile.orderCount} real order${profile.orderCount === 1 ? "" : "s"} totaling ₹${formatINR(profile.totalSalesValue)}`);
  } else {
    bits.push("with no real orders recorded yet");
  }
  if (profile.topIndustry) {
    bits.push(`; ${profile.topIndustry.industryName} is this company's strongest real segment there so far`);
  }
  const classificationLabel = result.classification.replace(/_/g, " ").toLowerCase();
  return `${bits.join(" ")}. Based on this company's own internal data, this state is classified as ${classificationLabel}.`;
}

/* -------------------------------------------------------------------------
 * AI narrative call + validation + retry + fallback — ONE batched call for
 * the whole narrated set, mirrors opportunities.service.ts's
 * runOpportunityNarrativePipeline exactly.
 * ---------------------------------------------------------------------- */

const MARKET_EXPANSION_AI_MAX_TOKENS = 3000;

interface NarrativeEntry {
  narrative: string;
  /** productId -> AI-phrased hedged statement. */
  hypothesisStatements: Map<string, string>;
}

async function callMarketExpansionAIOnce(
  aiProvider: AIProvider,
  candidates: MarketNarrationCandidate[],
  hypothesisAllowlist: Set<string>,
): Promise<Map<string, NarrativeEntry> | null> {
  try {
    const prompt = buildMarketExpansionPrompt(candidates);
    const completion = await aiProvider.generateCompletion(prompt, { maxTokens: MARKET_EXPANSION_AI_MAX_TOKENS, temperature: 0.3 });
    const requestedIds = candidates.map((c) => c.stateId);
    const parsed = parseAIMarketExpansionResponse(completion.content, requestedIds, hypothesisAllowlist);
    if (!parsed) return null;
    return new Map(
      parsed.map((e) => [e.stateId, { narrative: e.narrative, hypothesisStatements: new Map(e.hypothesisStatements.map((h) => [h.productId, h.statement])) }]),
    );
  } catch {
    return null;
  }
}

export interface NarrativePipelineResult {
  /** Present only for states the AI actually narrated (empty when the whole batch fell back). */
  entries: Map<string, NarrativeEntry>;
  method: ScoreMethod;
}

/**
 * Calls the AI provider once for the whole top-N batch, validates its JSON
 * output (shape + full stateId bijection + hypothesis-pairing allowlist),
 * retries once on failure/invalid output, then falls back to the
 * transparent RULE_BASED template for the ENTIRE batch — never a silent
 * failure, never a fallback presented as an AI insight.
 */
export async function runMarketNarrativePipeline(
  aiProvider: AIProvider,
  candidates: MarketNarrationCandidate[],
  hypothesisAllowlist: Set<string>,
): Promise<NarrativePipelineResult> {
  if (candidates.length === 0) {
    return { entries: new Map(), method: "RULE_BASED" };
  }

  let result = await callMarketExpansionAIOnce(aiProvider, candidates, hypothesisAllowlist);
  if (!result) {
    result = await callMarketExpansionAIOnce(aiProvider, candidates, hypothesisAllowlist); // one retry
  }

  if (result) {
    return { entries: result, method: "AI" };
  }

  return { entries: new Map(), method: "RULE_BASED" };
}

function toSummaryDTO(detail: MarketDetailDTO): MarketSummaryDTO {
  const { cityBreakdown: _cityBreakdown, industrySignals: _industrySignals, productSignals: _productSignals, growthSignal: _growthSignal, expansionHypotheses: _expansionHypotheses, ...summary } = detail;
  return summary;
}

/* -------------------------------------------------------------------------
 * Generation — runs across every real seeded state (regardless of data),
 * ranks the states with real evidence by score desc, narrates the top
 * `limit` via one batched AI call (or zero calls if there are none), and
 * builds a full MarketDetailDTO for EVERY state (including
 * INSUFFICIENT_DATA ones) so the detail-by-stateId endpoint can serve any
 * real state directly from this same generation without a second AI call.
 * States outside the narrated top-`limit` set get a RULE_BASED narrative —
 * a documented choice (not narrating them on demand) that keeps this
 * feature at exactly one batched AI call per company per day, matching
 * Phase 3A/3C's cost profile.
 * ---------------------------------------------------------------------- */

export interface GeneratedMarketData {
  generatedAt: string;
  /** Ranked (score desc), narrated markets only — states with at least some real evidence, capped at the generation-time `limit`. */
  narratedMarkets: MarketSummaryDTO[];
  /** Every real seeded state, keyed by stateId — used by the detail endpoint. */
  detailByStateId: Map<string, MarketDetailDTO>;
  totalStatesWithData: number;
  totalStatesAnalyzed: number;
  method: ScoreMethod;
}

async function generate(deps: MarketExpansionPrismaDeps, aiProvider: AIProvider, companyId: string, limit: number, now: Date): Promise<GeneratedMarketData> {
  const { profiles, products } = await gatherStateProfiles(deps, companyId);
  const totalActiveProductCount = products.length;
  const maxTotalSalesValueAcrossStatesWithOrders = computeMaxTotalSalesValueAcrossStatesWithOrders(profiles);

  const hypothesisCandidatesByState = computeExpansionHypothesisCandidates(profiles, products);

  const scored = profiles.map((profile) => ({
    profile,
    result: scoreState(profile, { now, maxTotalSalesValueAcrossStatesWithOrders, totalActiveProductCount, products }),
  }));

  const totalStatesAnalyzed = profiles.length;
  const withEvidence = scored.filter((s) => s.result.classification !== "INSUFFICIENT_DATA");
  const totalStatesWithData = withEvidence.length;

  const ranked = [...withEvidence].sort((a, b) => (b.result.score ?? 0) - (a.result.score ?? 0));
  const top = ranked.slice(0, limit);
  const topStateIds = new Set(top.map((s) => s.profile.stateId));

  const narrationCandidates: MarketNarrationCandidate[] = top.map(({ profile }) => ({
    stateId: profile.stateId,
    stateName: profile.stateName,
    evidence: buildEvidence(profile),
    hypotheses: (hypothesisCandidatesByState.get(profile.stateId) ?? []).map((h) => ({
      productId: h.productId,
      productName: h.productName,
      sourceStateName: h.sourceStateName,
      targetIndustryName: h.targetIndustryName,
    })),
  }));

  const hypothesisAllowlist = new Set<string>();
  for (const c of narrationCandidates) {
    for (const h of c.hypotheses) hypothesisAllowlist.add(`${c.stateId}:${h.productId}`);
  }

  // Zero states with real evidence -> zero AI calls (mirrors opportunities.service.ts's exact short-circuit).
  const { entries, method } =
    narrationCandidates.length > 0 ? await runMarketNarrativePipeline(aiProvider, narrationCandidates, hypothesisAllowlist) : { entries: new Map<string, NarrativeEntry>(), method: "RULE_BASED" as ScoreMethod };

  const detailByStateId = new Map<string, MarketDetailDTO>();

  for (const { profile, result } of scored) {
    const hypothesisCandidates: ExpansionHypothesisCandidate[] = hypothesisCandidatesByState.get(profile.stateId) ?? [];
    const narrated = topStateIds.has(profile.stateId) ? entries.get(profile.stateId) : undefined;
    const narrativeMethod: ScoreMethod = narrated ? method : "RULE_BASED";
    const narrative = narrated ? narrated.narrative : buildRuleBasedNarrative(profile, result);

    const expansionHypotheses: MarketExpansionHypothesis[] = hypothesisCandidates.map((h) => {
      const aiStatement = narrated?.hypothesisStatements.get(h.productId);
      return {
        productId: h.productId,
        productName: h.productName,
        sourceStateName: h.sourceStateName,
        targetIndustryName: h.targetIndustryName,
        statement: aiStatement ?? buildRuleBasedHypothesisStatement(h),
      };
    });

    const detail: MarketDetailDTO = {
      stateId: profile.stateId,
      stateName: profile.stateName,
      classification: result.classification,
      score: result.score,
      subScores: {
        existingDemand: Math.round(result.subScores.existingDemand),
        customerQuality: Math.round(result.subScores.customerQuality),
        productFit: Math.round(result.subScores.productFit),
        industryFit: Math.round(result.subScores.industryFit),
        growth: Math.round(result.subScores.growth),
        whitespace: Math.round(result.subScores.whitespace),
      },
      accountCount: profile.accountCount,
      prospectCount: profile.prospectCount,
      orderCount: profile.orderCount,
      totalSalesValue: String(Math.round(profile.totalSalesValue)),
      averageOrderValue: profile.averageOrderValue !== null ? profile.averageOrderValue.toFixed(2) : null,
      hotAccountCount: profile.hotAccountCount,
      warmAccountCount: profile.warmAccountCount,
      topIndustryName: profile.topIndustry?.industryName ?? null,
      evidence: buildEvidence(profile),
      narrative,
      narrativeMethod,
      cityBreakdown: profile.cityBreakdown.map((c) => ({ cityId: c.cityId, cityName: c.cityName, orderCount: c.orderCount, totalValue: String(Math.round(c.totalValue)) })),
      industrySignals: profile.industryBreakdown.map((i) => ({
        industryId: i.industryId,
        industryName: i.industryName,
        accountCount: i.accountCount,
        orderCount: i.orderCount,
        totalValue: String(Math.round(i.totalValue)),
      })),
      productSignals: profile.productBreakdown.map((p) => ({ productId: p.productId, productName: p.productName, orderCount: p.orderCount, totalValue: String(Math.round(p.totalValue)) })),
      growthSignal: result.growthSignal,
      expansionHypotheses,
    };

    detailByStateId.set(profile.stateId, detail);
  }

  const narratedMarkets = top.map(({ profile }) => toSummaryDTO(detailByStateId.get(profile.stateId)!));

  return {
    generatedAt: now.toISOString(),
    narratedMarkets,
    detailByStateId,
    totalStatesWithData,
    totalStatesAnalyzed,
    method,
  };
}

/* -------------------------------------------------------------------------
 * In-memory per-company daily cache. Same shape/tradeoffs as
 * opportunities.service.ts / sales-agent.service.ts's cache (a module-level
 * Map, not persisted):
 *  - Lost on every process restart (regenerates lazily on the next request).
 *  - Does not span multiple backend instances if horizontally scaled.
 *  - The cached `narratedMarkets` list is NOT re-keyed by `limit` — a cache
 *    hit returns whatever narration limit was in effect when that day's
 *    entry was generated, regardless of the `limit` on a later same-day
 *    request. Accepted tradeoff for consistency with Phase 3A/3C, not a bug.
 *  - `detailByStateId` covers every real state regardless of `limit`, so the
 *    detail-by-stateId endpoint is unaffected by this tradeoff.
 * ---------------------------------------------------------------------- */

interface CacheEntry extends GeneratedMarketData {
  date: string; // YYYY-MM-DD
}

const cache = new Map<string, CacheEntry>();

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Cheap, I/O-free cache peek used by the route layer (mirrors opportunities.routes.ts's rateLimitIfGenerating pattern exactly). */
export function willRequireGeneration(companyId: string, force: boolean, now: Date = new Date()): boolean {
  if (force) return true;
  const entry = cache.get(companyId);
  return !entry || entry.date !== toDateKey(now);
}

/** Test-only: resets the module-level cache between test cases. */
export function clearMarketExpansionCache(): void {
  cache.clear();
}

async function getOrGenerate(deps: MarketExpansionPrismaDeps, aiProvider: AIProvider, companyId: string, limit: number, force: boolean, now: Date): Promise<{ entry: CacheEntry; wasGenerated: boolean }> {
  const dateKey = toDateKey(now);
  const cached = !force ? cache.get(companyId) : undefined;
  if (cached && cached.date === dateKey) {
    return { entry: cached, wasGenerated: false };
  }
  const generated = await generate(deps, aiProvider, companyId, limit, now);
  const entry: CacheEntry = { ...generated, date: dateKey };
  cache.set(companyId, entry);
  return { entry, wasGenerated: true };
}

export interface GetMarketExpansionSummaryParams {
  companyId: string;
  limit: number;
  force: boolean;
  now?: Date;
}

export interface GetMarketExpansionSummaryResult {
  dto: MarketExpansionSummaryDTO;
  wasGenerated: boolean;
  method: ScoreMethod;
}

/**
 * Top-level orchestration for GET /market-expansion: serves the cached
 * response for today if one exists (unless force=true), otherwise gathers
 * every real state, scores/classifies deterministically, narrates the top
 * `limit` via the AI/fallback pipeline, caches the full result for the rest
 * of today, and returns the ranked/narrated summary list.
 */
export async function getMarketExpansionSummary(deps: MarketExpansionPrismaDeps, aiProvider: AIProvider, params: GetMarketExpansionSummaryParams): Promise<GetMarketExpansionSummaryResult> {
  const now = params.now ?? new Date();
  const { entry, wasGenerated } = await getOrGenerate(deps, aiProvider, params.companyId, params.limit, params.force, now);

  const dto: MarketExpansionSummaryDTO = {
    generatedAt: entry.generatedAt,
    markets: entry.narratedMarkets,
    totalStatesWithData: entry.totalStatesWithData,
    totalStatesAnalyzed: entry.totalStatesAnalyzed,
  };

  return { dto, wasGenerated, method: entry.method };
}

export interface GetMarketDetailParams {
  companyId: string;
  stateId: string;
  force: boolean;
  now?: Date;
}

export interface GetMarketDetailResult {
  /** null when stateId doesn't correspond to any real seeded State — the controller turns this into a 404. A real state with zero evidence returns the full INSUFFICIENT_DATA DTO shape instead of null. */
  dto: MarketDetailDTO | null;
  wasGenerated: boolean;
  method: ScoreMethod;
}

/**
 * Top-level orchestration for GET /market-expansion/:stateId. Reuses the
 * same per-company daily cache/generation as the summary endpoint — since
 * `generate()` already computes a full MarketDetailDTO for every real state
 * (not just the narrated top-`limit` set), this never needs a second AI call
 * just to serve one state's detail.
 */
export async function getMarketDetail(deps: MarketExpansionPrismaDeps, aiProvider: AIProvider, params: GetMarketDetailParams): Promise<GetMarketDetailResult> {
  const now = params.now ?? new Date();
  const { entry, wasGenerated } = await getOrGenerate(deps, aiProvider, params.companyId, MARKET_EXPANSION_DEFAULT_LIMIT, params.force, now);

  const dto = entry.detailByStateId.get(params.stateId) ?? null;
  return { dto, wasGenerated, method: entry.method };
}
