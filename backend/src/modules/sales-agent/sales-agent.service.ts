/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LeadClassification, SalesAgentPriorityDTO, SalesAgentTodayDTO, ScoreMethod } from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import type { StateAlignment } from "../leads/scoring.service.js";
import {
  assemblePriorityCandidate,
  buildRuleBasedRecommendedAction,
  rankCandidates,
  type PriorityCandidate,
  type ProductCandidate,
} from "./priority.service.js";
import { buildSalesAgentPrompt } from "./sales-agent.prompt.js";
import { parseAISalesAgentResponse, type AISalesAgentEntry } from "./sales-agent.schema.js";

/* -------------------------------------------------------------------------
 * Narrow, injectable Prisma-like dependency interface (mirrors
 * ScoringPrismaDeps) so candidate gathering is unit-testable without a live
 * DB. A real PrismaClient satisfies this structurally — no adapter needed.
 * ---------------------------------------------------------------------- */

export interface SalesAgentPrismaDeps {
  leadScore: {
    findMany(args: any): Promise<any[]>;
  };
  salesRecord: {
    findMany(args: any): Promise<any[]>;
  };
  product: {
    findMany(args: any): Promise<any[]>;
  };
}

/* -------------------------------------------------------------------------
 * Candidate gathering — reads real Account/Prospect/LeadScore/SalesRecord/
 * Product data and turns it into fully-computed PriorityCandidates via the
 * pure functions in priority.service.ts. The only I/O in this module.
 * ---------------------------------------------------------------------- */

interface StoredInputFeatures {
  recencyDays: number | null;
  averageOrderValue: number | null;
  productFitScore: number;
  stateAlignment: StateAlignment;
}

/** Reads the subset of Phase 2's LeadScore.inputFeatures JSON this feature needs. Defensive against missing/malformed fields — never throws, never invents a number. */
function readInputFeatures(raw: unknown): StoredInputFeatures {
  const f = (raw ?? {}) as Partial<Record<keyof StoredInputFeatures, unknown>>;
  return {
    recencyDays: typeof f.recencyDays === "number" ? f.recencyDays : null,
    averageOrderValue: typeof f.averageOrderValue === "number" ? f.averageOrderValue : null,
    productFitScore: typeof f.productFitScore === "number" ? f.productFitScore : 0,
    stateAlignment: (typeof f.stateAlignment === "string" ? f.stateAlignment : "unknown") as StateAlignment,
  };
}

export interface GatheredCandidates {
  candidates: PriorityCandidate[];
  /** Total HOT/WARM scored leads found, before the top-N narration cap is applied. */
  totalCandidates: number;
}

/**
 * Loads every HOT/WARM-classified lead's latest LeadScore (Accounts and
 * Prospects together, in one query — mirrors leads.service.ts's
 * getLeadSummary "topHotLeads" pattern), their real order history (for the
 * reorder-timing signal), and the company's active products (for candidate
 * product suggestions), then assembles a PriorityCandidate per lead. COLD
 * and unscored leads never appear here — they're excluded by the query
 * itself, not filtered after the fact.
 */
export async function gatherCandidates(deps: SalesAgentPrismaDeps, companyId: string): Promise<GatheredCandidates> {
  const latestScores = await deps.leadScore.findMany({
    where: { companyId, isLatest: true, classification: { in: ["HOT", "WARM"] } },
    include: {
      account: { include: { industry: true, state: true, city: true } },
      prospect: { include: { industry: true, businessType: true, state: true, city: true } },
    },
  });

  const totalCandidates = latestScores.length;
  if (totalCandidates === 0) {
    return { candidates: [], totalCandidates: 0 };
  }

  const accountIds = latestScores.filter((s: any) => Boolean(s.accountId)).map((s: any) => s.accountId as string);

  const [salesRecords, products] = await Promise.all([
    accountIds.length > 0
      ? deps.salesRecord.findMany({
          where: { companyId, accountId: { in: accountIds }, cancelledAt: null },
          select: { accountId: true, date: true, orderValue: true },
        })
      : Promise.resolve([]),
    deps.product.findMany({
      where: { companyId, isActive: true },
      include: { targetIndustries: true, targetBusinessTypes: true },
    }),
  ]);

  const ordersByAccount = new Map<string, { date: Date; orderValue: number }[]>();
  for (const r of salesRecords as any[]) {
    if (!r.accountId) continue;
    const list = ordersByAccount.get(r.accountId) ?? [];
    list.push({ date: new Date(r.date), orderValue: Number(r.orderValue) });
    ordersByAccount.set(r.accountId, list);
  }

  const candidateProducts: ProductCandidate[] = (products as any[]).map((p) => ({
    name: p.name as string,
    targetIndustryIds: (p.targetIndustries ?? []).map((t: any) => t.industryId as string),
    targetBusinessTypeIds: (p.targetBusinessTypes ?? []).map((t: any) => t.businessTypeId as string),
  }));

  const candidates: PriorityCandidate[] = latestScores.map((s: any) => {
    const isAccount = Boolean(s.accountId);
    const lead = isAccount ? s.account : s.prospect;
    const features = readInputFeatures(s.inputFeatures);
    const orders = isAccount ? (ordersByAccount.get(s.accountId as string) ?? []) : [];
    const latestOrderValue =
      orders.length > 0
        ? orders.reduce((latest, o) => (o.date.getTime() > latest.date.getTime() ? o : latest)).orderValue
        : null;

    return assemblePriorityCandidate({
      leadId: isAccount ? (s.accountId as string) : (s.prospectId as string),
      leadType: isAccount ? "accounts" : "prospects",
      name: isAccount ? (lead?.name as string) : (lead?.businessName as string),
      score: s.score as number,
      classification: s.classification as LeadClassification,
      industryId: lead?.industryId ?? null,
      businessTypeId: isAccount ? null : (lead?.businessTypeId ?? null),
      stateId: lead?.stateId ?? null,
      recencyDays: features.recencyDays,
      averageOrderValue: features.averageOrderValue,
      productFitScore: features.productFitScore,
      stateAlignment: features.stateAlignment,
      orderDates: orders.map((o) => o.date),
      latestOrderValue,
      candidateProducts,
    });
  });

  return { candidates, totalCandidates };
}

/* -------------------------------------------------------------------------
 * AI narrative call + validation + retry + fallback — mirrors
 * scoring.service.ts's runScoringPipeline pattern exactly, but ONE batched
 * call for the whole top-N set rather than one call per lead.
 * ---------------------------------------------------------------------- */

const NARRATIVE_AI_MAX_TOKENS = 2000;

async function callNarrativeAIOnce(aiProvider: AIProvider, candidates: PriorityCandidate[]): Promise<AISalesAgentEntry[] | null> {
  try {
    const prompt = buildSalesAgentPrompt(candidates);
    const completion = await aiProvider.generateCompletion(prompt, { maxTokens: NARRATIVE_AI_MAX_TOKENS, temperature: 0.3 });
    const requestedLeadIds = candidates.map((c) => c.leadId);
    const productAllowlistByLeadId = new Map(candidates.map((c) => [c.leadId, c.candidateProductNames]));
    return parseAISalesAgentResponse(completion.content, requestedLeadIds, productAllowlistByLeadId);
  } catch {
    return null;
  }
}

function toPriorityDTO(
  candidate: PriorityCandidate,
  narrative: { reasons: string[]; recommendedAction: string; productSuggestion: string | null; narrativeMethod: ScoreMethod },
): SalesAgentPriorityDTO {
  return {
    leadId: candidate.leadId,
    leadType: candidate.leadType,
    name: candidate.name,
    score: candidate.score, // copied verbatim from the lead's LeadScore — never recomputed here
    classification: candidate.classification, // copied verbatim, same as above
    priority: candidate.priority,
    reasons: narrative.reasons,
    recommendedAction: narrative.recommendedAction,
    productSuggestion: narrative.productSuggestion,
    narrativeMethod: narrative.narrativeMethod,
    dataConfidence: candidate.dataConfidence,
  };
}

function ruleBasedNarrativeFor(candidate: PriorityCandidate): SalesAgentPriorityDTO {
  return toPriorityDTO(candidate, {
    reasons: candidate.deterministicReasons,
    recommendedAction: buildRuleBasedRecommendedAction(candidate.priority, candidate.classification),
    productSuggestion: candidate.deterministicProductSuggestion,
    narrativeMethod: "RULE_BASED",
  });
}

export interface NarrativePipelineResult {
  priorities: SalesAgentPriorityDTO[];
  method: ScoreMethod;
}

/**
 * Calls the AI provider once for the whole top-N batch, validates its JSON
 * output (shape + the leadId bijection + the product-allowlist check),
 * retries once on failure/invalid output, then falls back to the
 * transparent RULE_BASED template for the ENTIRE batch — never a silent
 * failure, never a fallback presented as an AI insight.
 */
export async function runNarrativePipeline(aiProvider: AIProvider, candidates: PriorityCandidate[]): Promise<NarrativePipelineResult> {
  if (candidates.length === 0) {
    return { priorities: [], method: "RULE_BASED" };
  }

  let aiResult = await callNarrativeAIOnce(aiProvider, candidates);
  if (!aiResult) {
    aiResult = await callNarrativeAIOnce(aiProvider, candidates); // one retry
  }

  if (aiResult) {
    const byId = new Map(aiResult.map((r) => [r.leadId, r]));
    const priorities = candidates.map((c) => {
      const entry = byId.get(c.leadId);
      // parseAISalesAgentResponse already enforces a full bijection with the requested leadIds,
      // so `entry` is always present here — the fallback below is defensive-only.
      if (!entry) return ruleBasedNarrativeFor(c);
      return toPriorityDTO(c, {
        reasons: entry.reasons,
        recommendedAction: entry.recommendedAction,
        productSuggestion: entry.productSuggestion,
        narrativeMethod: "AI",
      });
    });
    return { priorities, method: "AI" };
  }

  return { priorities: candidates.map(ruleBasedNarrativeFor), method: "RULE_BASED" };
}

/* -------------------------------------------------------------------------
 * In-memory per-company cache. Deliberately module-level (acts like a
 * singleton within this backend process) instead of persisted to the DB —
 * this is a same-day-derived view, not a record of truth, so a new table/
 * migration for it isn't warranted for Phase 3A.
 *
 * Tradeoffs accepted, not bugs:
 *  - Lost on every process restart (regenerates lazily on the next request).
 *  - Does not span multiple backend instances if this service is ever
 *    horizontally scaled — a request landing on a different instance can
 *    trigger its own regeneration independently.
 * ---------------------------------------------------------------------- */

interface CacheEntry {
  date: string; // YYYY-MM-DD
  response: SalesAgentTodayDTO;
}

const cache = new Map<string, CacheEntry>();

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Cheap, I/O-free cache peek used by the route layer to decide whether a
 * given request will actually trigger generation (cache miss or
 * force=true) — and therefore whether the AI-cost rate limiter should apply
 * to it. A cache hit never counts against the rate limit.
 */
export function willRequireGeneration(companyId: string, force: boolean, now: Date = new Date()): boolean {
  if (force) return true;
  const entry = cache.get(companyId);
  return !entry || entry.date !== toDateKey(now);
}

/** Test-only: resets the module-level cache between test cases. */
export function clearSalesAgentCache(): void {
  cache.clear();
}

export interface GetSalesAgentTodayParams {
  companyId: string;
  limit: number;
  force: boolean;
  now?: Date;
}

export interface GetSalesAgentTodayResult {
  dto: SalesAgentTodayDTO;
  /** True when candidate gathering + the narrative pipeline actually ran (cache miss or force=true) — callers use this to decide whether to write an audit log entry. */
  wasGenerated: boolean;
}

/**
 * Top-level orchestration: serves the cached response for today if one
 * exists (unless force=true), otherwise gathers real HOT/WARM candidates,
 * ranks them deterministically, narrates the top `limit` via the AI/
 * fallback pipeline, caches the result for the rest of today, and returns
 * it. Never calls AI on every dashboard re-render — only on the first
 * request of the day per company, or an explicit force=true.
 */
export async function getSalesAgentToday(
  deps: SalesAgentPrismaDeps,
  aiProvider: AIProvider,
  params: GetSalesAgentTodayParams,
): Promise<GetSalesAgentTodayResult> {
  const now = params.now ?? new Date();
  const dateKey = toDateKey(now);

  if (!params.force) {
    const cached = cache.get(params.companyId);
    if (cached && cached.date === dateKey) {
      return { dto: cached.response, wasGenerated: false };
    }
  }

  const { candidates, totalCandidates } = await gatherCandidates(deps, params.companyId);
  const ranked = rankCandidates(candidates);
  const top = ranked.slice(0, params.limit);

  const { priorities } = await runNarrativePipeline(aiProvider, top);

  const dto: SalesAgentTodayDTO = {
    generatedAt: now.toISOString(),
    priorities,
    totalCandidates,
  };

  cache.set(params.companyId, { date: dateKey, response: dto });
  return { dto, wasGenerated: true };
}
