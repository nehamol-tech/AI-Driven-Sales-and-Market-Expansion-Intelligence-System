import type { DailyPriorityLevel, OpportunityDTO, OpportunitySummaryDTO, OpportunityType, ScoreMethod } from "@ai-sales/shared";
import { OPPORTUNITY_TYPES } from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import { gatherAccountProfiles, type AccountProfile, type CrossSellProductCandidate, type OpportunitiesPrismaDeps } from "./account-profile.service.js";
import {
  computeTopValueAccounts,
  detectAtRisk,
  detectCrossSell,
  detectGrowingAccount,
  detectHighValue,
  detectReactivation,
  detectReorder,
  HIGH_VALUE_TOP_PERCENTILE,
  type OpportunityCandidate,
} from "./detectors.js";
import { buildOpportunitiesPrompt } from "./opportunities.prompt.js";
import { parseAIOpportunityResponse } from "./opportunities.schema.js";

export type { OpportunitiesPrismaDeps } from "./account-profile.service.js";

/* -------------------------------------------------------------------------
 * Detection — runs every detector across every account profile in the
 * company, once. This is the full real candidate list: `counts`/
 * `totalOpportunities` in the final DTO are computed from THIS set, before
 * any narration cap is applied.
 * ---------------------------------------------------------------------- */

function emptyCounts(): Record<OpportunityType, number> {
  const counts = {} as Record<OpportunityType, number>;
  for (const t of OPPORTUNITY_TYPES) counts[t] = 0;
  return counts;
}

export interface DetectionResult {
  candidates: OpportunityCandidate[];
  counts: Record<OpportunityType, number>;
  highPriorityCount: number;
}

/**
 * Runs all 6 detectors across every real account profile. REORDER, AT_RISK,
 * GROWING_ACCOUNT, CROSS_SELL, and REACTIVATION run first (first pass);
 * HIGH_VALUE runs second, per account, so it can check the same account's
 * real results from the first pass (never reimplements their logic) — per
 * the Phase 3C spec.
 */
export function detectAllOpportunities(input: { profiles: AccountProfile[]; products: CrossSellProductCandidate[] }, now: Date): DetectionResult {
  const { profiles, products } = input;
  const topValueInfo = computeTopValueAccounts(profiles, HIGH_VALUE_TOP_PERCENTILE);

  const candidates: OpportunityCandidate[] = [];
  const reorderByAccount = new Set<string>();
  const atRiskByAccount = new Set<string>();
  const growingByAccount = new Set<string>();
  const crossSellCountByAccount = new Map<string, number>();
  const reactivationByAccount = new Set<string>();

  for (const profile of profiles) {
    const reorder = detectReorder(profile);
    if (reorder) {
      candidates.push(reorder);
      reorderByAccount.add(profile.id);
    }

    const atRisk = detectAtRisk(profile, now);
    if (atRisk) {
      candidates.push(atRisk);
      atRiskByAccount.add(profile.id);
    }

    const growing = detectGrowingAccount(profile, now);
    if (growing) {
      candidates.push(growing);
      growingByAccount.add(profile.id);
    }

    const crossSell = detectCrossSell(profile, products);
    if (crossSell.length > 0) {
      candidates.push(...crossSell);
      crossSellCountByAccount.set(profile.id, crossSell.length);
    }

    const reactivation = detectReactivation(profile, topValueInfo);
    if (reactivation) {
      candidates.push(reactivation);
      reactivationByAccount.add(profile.id);
    }
  }

  // Second pass — HIGH_VALUE, checking the same account's real first-pass results.
  for (const profile of profiles) {
    const highValue = detectHighValue(profile, topValueInfo, {
      hasReorder: reorderByAccount.has(profile.id),
      hasAtRisk: atRiskByAccount.has(profile.id),
      crossSellCount: crossSellCountByAccount.get(profile.id) ?? 0,
      hasReactivation: reactivationByAccount.has(profile.id),
      hasGrowing: growingByAccount.has(profile.id),
    });
    if (highValue) candidates.push(highValue);
  }

  const counts = emptyCounts();
  let highPriorityCount = 0;
  for (const c of candidates) {
    counts[c.type] += 1;
    if (c.priority === "HIGH") highPriorityCount += 1;
  }

  return { candidates, counts, highPriorityCount };
}

/* -------------------------------------------------------------------------
 * Ranking — priority desc (HIGH > MEDIUM > LOW), then the per-candidate
 * `rankSignal` desc as a real secondary signal (overdue days, decline/growth
 * %, order value, days dormant, etc. depending on type). Documented choice,
 * not the only valid one.
 * ---------------------------------------------------------------------- */

const PRIORITY_RANK: Record<DailyPriorityLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export function rankOpportunityCandidates(candidates: OpportunityCandidate[]): OpportunityCandidate[] {
  return [...candidates].sort((a, b) => {
    const p = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (p !== 0) return p;
    return b.rankSignal - a.rankSignal;
  });
}

/* -------------------------------------------------------------------------
 * AI narrative call + validation + retry + fallback — ONE batched call for
 * the whole narrated set, mirrors sales-agent.service.ts's
 * runNarrativePipeline exactly.
 * ---------------------------------------------------------------------- */

const OPPORTUNITIES_AI_MAX_TOKENS = 2500;

interface NarrativeEntry {
  narrative: string;
  recommendedAction: string;
}

async function callOpportunityAIOnce(aiProvider: AIProvider, candidates: OpportunityCandidate[]): Promise<Map<string, NarrativeEntry> | null> {
  try {
    const prompt = buildOpportunitiesPrompt(candidates);
    const completion = await aiProvider.generateCompletion(prompt, { maxTokens: OPPORTUNITIES_AI_MAX_TOKENS, temperature: 0.3 });
    const requestedIds = candidates.map((c) => c.id);
    const parsed = parseAIOpportunityResponse(completion.content, requestedIds);
    if (!parsed) return null;
    return new Map(parsed.map((e) => [e.id, { narrative: e.narrative, recommendedAction: e.recommendedAction }]));
  } catch {
    return null;
  }
}

export interface NarrativePipelineResult {
  /** Present only for candidates the AI actually narrated (empty when the whole batch fell back). */
  entries: Map<string, NarrativeEntry>;
  method: ScoreMethod;
}

/**
 * Calls the AI provider once for the whole top-N batch, validates its JSON
 * output (shape + a full id bijection), retries once on failure/invalid
 * output, then falls back to the transparent RULE_BASED template for the
 * ENTIRE batch (each candidate's own precomputed
 * ruleBasedNarrative/ruleBasedRecommendedAction from detectors.ts) — never a
 * silent failure, never a fallback presented as an AI insight.
 */
export async function runOpportunityNarrativePipeline(aiProvider: AIProvider, candidates: OpportunityCandidate[]): Promise<NarrativePipelineResult> {
  if (candidates.length === 0) {
    return { entries: new Map(), method: "RULE_BASED" };
  }

  let result = await callOpportunityAIOnce(aiProvider, candidates);
  if (!result) {
    result = await callOpportunityAIOnce(aiProvider, candidates); // one retry
  }

  if (result) {
    return { entries: result, method: "AI" };
  }

  return { entries: new Map(), method: "RULE_BASED" };
}

function toDTO(candidate: OpportunityCandidate, entry: NarrativeEntry | undefined, method: ScoreMethod): OpportunityDTO {
  return {
    id: candidate.id,
    type: candidate.type,
    leadId: candidate.leadId,
    leadType: candidate.leadType,
    name: candidate.name,
    priority: candidate.priority,
    score: candidate.score,
    classification: candidate.classification,
    productId: candidate.productId,
    productName: candidate.productName,
    evidence: candidate.evidence,
    recommendedAction: entry ? entry.recommendedAction : candidate.ruleBasedRecommendedAction,
    narrative: entry ? entry.narrative : candidate.ruleBasedNarrative,
    narrativeMethod: entry ? method : "RULE_BASED",
  };
}

/* -------------------------------------------------------------------------
 * In-memory per-company daily cache. Same shape/tradeoffs as
 * sales-agent.service.ts's cache (a module-level Map, not persisted):
 *  - Lost on every process restart (regenerates lazily on the next request).
 *  - Does not span multiple backend instances if horizontally scaled.
 *  - Like Phase 3A, the cached response is not re-keyed by `limit` — a
 *    cache hit returns whatever narration limit was in effect when that
 *    day's entry was generated, regardless of the `limit` on a later
 *    same-day request. Accepted tradeoff for consistency with Phase 3A,
 *    not a bug.
 * `type`/`priority` filters are NOT part of the cache key — they're applied
 * to the cached/generated list on every request (see getOpportunities),
 * never trigger a fresh detection pass on their own.
 * ---------------------------------------------------------------------- */

interface CacheEntry {
  date: string; // YYYY-MM-DD
  response: OpportunitySummaryDTO;
  /** The narration method used for this generation — stored alongside the DTO (not part of the DTO's own shape) so callers can log it accurately even when a type/priority filter narrows `opportunities` down to zero entries. */
  method: ScoreMethod;
}

const cache = new Map<string, CacheEntry>();

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Cheap, I/O-free cache peek used by the route layer (mirrors sales-agent.routes.ts's rateLimitIfGenerating pattern exactly). */
export function willRequireGeneration(companyId: string, force: boolean, now: Date = new Date()): boolean {
  if (force) return true;
  const entry = cache.get(companyId);
  return !entry || entry.date !== toDateKey(now);
}

/** Test-only: resets the module-level cache between test cases. */
export function clearOpportunitiesCache(): void {
  cache.clear();
}

export interface GetOpportunitiesParams {
  companyId: string;
  limit: number;
  force: boolean;
  type?: OpportunityType;
  priority?: DailyPriorityLevel;
  now?: Date;
}

export interface GetOpportunitiesResult {
  dto: OpportunitySummaryDTO;
  /** True when detection + the narrative pipeline actually ran (cache miss or force=true) — callers use this to decide whether to write an audit log entry. */
  wasGenerated: boolean;
  /** The narration method for this generation (AI or RULE_BASED) — accurate even when a type/priority filter narrows `dto.opportunities` to zero entries, unlike inferring it from the first returned opportunity. */
  method: ScoreMethod;
}

async function generate(deps: OpportunitiesPrismaDeps, aiProvider: AIProvider, companyId: string, limit: number, now: Date): Promise<{ response: OpportunitySummaryDTO; method: ScoreMethod }> {
  const { profiles, products } = await gatherAccountProfiles(deps, companyId, now);
  const { candidates, counts, highPriorityCount } = detectAllOpportunities({ profiles, products }, now);

  const ranked = rankOpportunityCandidates(candidates);
  const top = ranked.slice(0, limit);

  const { entries, method } = await runOpportunityNarrativePipeline(aiProvider, top);
  const opportunities = top.map((c) => toDTO(c, entries.get(c.id), method));

  return {
    response: {
      generatedAt: now.toISOString(),
      counts,
      highPriorityCount,
      opportunities,
      totalOpportunities: candidates.length,
    },
    method,
  };
}

/**
 * Top-level orchestration: serves the cached response for today if one
 * exists (unless force=true), otherwise detects real opportunities across
 * every account, ranks them deterministically, narrates the top `limit` via
 * the AI/fallback pipeline, caches the result for the rest of today, and
 * returns it.
 *
 * `counts`/`highPriorityCount`/`totalOpportunities` always reflect the FULL
 * detected set for that cached generation (independent of both `limit` and
 * any `type`/`priority` filter) — only the `opportunities` array is
 * filtered per request, per the DTO's own "independent of the narration cap"
 * doc comment. This is a deliberate choice: counts should always describe
 * the true landscape, not the filtered view.
 */
export async function getOpportunities(deps: OpportunitiesPrismaDeps, aiProvider: AIProvider, params: GetOpportunitiesParams): Promise<GetOpportunitiesResult> {
  const now = params.now ?? new Date();
  const dateKey = toDateKey(now);

  let response: OpportunitySummaryDTO;
  let method: ScoreMethod;
  let wasGenerated = false;

  const cached = !params.force ? cache.get(params.companyId) : undefined;
  if (cached && cached.date === dateKey) {
    response = cached.response;
    method = cached.method;
  } else {
    const generated = await generate(deps, aiProvider, params.companyId, params.limit, now);
    response = generated.response;
    method = generated.method;
    cache.set(params.companyId, { date: dateKey, response, method });
    wasGenerated = true;
  }

  const filteredOpportunities = response.opportunities.filter(
    (o) => (params.type === undefined || o.type === params.type) && (params.priority === undefined || o.priority === params.priority),
  );

  return {
    dto: { ...response, opportunities: filteredOpportunities },
    wasGenerated,
    method,
  };
}
