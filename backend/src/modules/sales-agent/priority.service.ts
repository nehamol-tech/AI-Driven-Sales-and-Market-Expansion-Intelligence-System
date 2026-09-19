import type { DailyPriorityLevel, DataConfidenceLevel, LeadClassification, LeadType } from "@ai-sales/shared";
import type { StateAlignment } from "../leads/scoring.service.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------------
 * Reorder-timing signal — computed here (not part of Phase 2's
 * inputFeatures) from real SalesRecord order dates. Only ever computed from
 * >=2 real orders; never invented for a lead with fewer.
 * ---------------------------------------------------------------------- */

export interface ReorderTimingInput {
  /** Real order dates for this lead (Accounts only — Prospects have none). */
  orderDates: Date[];
  /** Days since the most recent order, from the lead's existing LeadScore.inputFeatures. */
  recencyDays: number | null;
}

export interface ReorderTiming {
  averageReorderIntervalDays: number | null;
  /** recencyDays - averageReorderIntervalDays. Negative = not yet due. Null if either input is unavailable. */
  overdueByDays: number | null;
}

export function computeReorderTiming(input: ReorderTimingInput): ReorderTiming {
  if (input.orderDates.length < 2) {
    return { averageReorderIntervalDays: null, overdueByDays: null };
  }

  const sorted = [...input.orderDates].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i].getTime() - sorted[i - 1].getTime()) / MS_PER_DAY);
  }
  const averageReorderIntervalDays = round2(gaps.reduce((sum, g) => sum + g, 0) / gaps.length);

  const overdueByDays = input.recencyDays !== null ? round2(input.recencyDays - averageReorderIntervalDays) : null;

  return { averageReorderIntervalDays, overdueByDays };
}

/* -------------------------------------------------------------------------
 * Deterministic priority score + bucketing. Pure, no AI, no I/O — the AI
 * never decides priority, only phrases the narrative around it.
 *
 * Formula (documented per the spec, tuned from the default thresholds so
 * obvious test cases classify correctly):
 *   base         = HOT ? 100 : 50                              (WARM)
 *   overdueBonus = clamp(overdueByDays, 0, 60) * 0.5            (max 30)
 *   scoreBonus   = score * 0.3                                  (max 30, score is 0-100)
 *   priorityScore = base + overdueBonus + scoreBonus
 *
 * Bucket thresholds: >= 125 -> HIGH, >= 80 -> MEDIUM, else LOW.
 * With this formula a WARM lead's ceiling is base(50) + scoreBonus(<21,
 * since WARM tops out just under 70) + overdueBonus(30) ~= 100.9, so WARM
 * leads can reach MEDIUM but never HIGH — HIGH is reserved for HOT leads
 * with a meaningfully strong score and/or a real overdue-reorder signal.
 * ---------------------------------------------------------------------- */

export const PRIORITY_HIGH_THRESHOLD = 125;
export const PRIORITY_MEDIUM_THRESHOLD = 80;

export interface PriorityScoreInput {
  /** HOT or WARM only — candidates are pre-filtered to exclude COLD/unscored leads. */
  classification: LeadClassification;
  score: number;
  overdueByDays: number | null;
}

export function computePriorityScore(input: PriorityScoreInput): number {
  const base = input.classification === "HOT" ? 100 : 50;
  const overdueBonus = input.overdueByDays !== null ? Math.max(0, Math.min(input.overdueByDays, 60)) * 0.5 : 0;
  const scoreBonus = input.score * 0.3;
  return round2(base + overdueBonus + scoreBonus);
}

export function bucketPriority(priorityScore: number): DailyPriorityLevel {
  if (priorityScore >= PRIORITY_HIGH_THRESHOLD) return "HIGH";
  if (priorityScore >= PRIORITY_MEDIUM_THRESHOLD) return "MEDIUM";
  return "LOW";
}

/* -------------------------------------------------------------------------
 * Deterministic reasons — always real, always computable without AI. This
 * is what the RULE_BASED fallback uses verbatim, and what the AI prompt is
 * given as ground truth to phrase naturally (never beyond).
 * ---------------------------------------------------------------------- */

export interface DeterministicReasonsInput {
  classification: LeadClassification;
  score: number;
  overdueByDays: number | null;
  averageReorderIntervalDays: number | null;
  /** Real value of the most recent order (Accounts only). */
  latestOrderValue: number | null;
  /** From the lead's existing LeadScore.inputFeatures. */
  averageOrderValue: number | null;
  productFitScore: number;
  stateAlignment: StateAlignment;
}

function formatINR(value: number): string {
  return Math.round(value).toLocaleString("en-IN");
}

export function buildDeterministicReasons(input: DeterministicReasonsInput): string[] {
  const reasons: string[] = [`${input.classification} classification (score ${input.score})`];

  if (input.overdueByDays !== null && input.averageReorderIntervalDays !== null) {
    if (input.overdueByDays > 0) {
      reasons.push(
        `Overdue for reorder by ${Math.round(input.overdueByDays)} days (usual cycle ~${Math.round(input.averageReorderIntervalDays)} days)`,
      );
    } else {
      reasons.push(`Not yet due for reorder (usual cycle ~${Math.round(input.averageReorderIntervalDays)} days)`);
    }
  }

  if (input.latestOrderValue !== null && input.averageOrderValue !== null && input.latestOrderValue > input.averageOrderValue) {
    reasons.push(`Recent order value was ₹${formatINR(input.latestOrderValue)}, above this account's average`);
  }

  if (input.productFitScore > 0) {
    reasons.push(`Strong product fit (${input.productFitScore})`);
  }

  if (input.stateAlignment === "operating") {
    reasons.push("Within an operating state");
  } else if (input.stateAlignment === "target") {
    reasons.push("Within a target state");
  }

  return reasons;
}

/** Deterministic recommendedAction template — used by the RULE_BASED fallback, never AI. */
export function buildRuleBasedRecommendedAction(priority: DailyPriorityLevel, classification: LeadClassification): string {
  if (priority === "HIGH") return "Contact today";
  if (priority === "MEDIUM") return classification === "HOT" ? "Contact within 2 days" : "Follow up this week";
  return "Monitor — no immediate action needed";
}

/* -------------------------------------------------------------------------
 * Candidate product suggestion — real data only. Never invented.
 * ---------------------------------------------------------------------- */

export interface ProductCandidate {
  name: string;
  targetIndustryIds: string[];
  targetBusinessTypeIds: string[];
}

export function findMatchingProductNames(
  products: ProductCandidate[],
  industryId: string | null,
  businessTypeId: string | null,
): string[] {
  if (!industryId && !businessTypeId) return [];
  return products
    .filter(
      (p) =>
        (industryId !== null && p.targetIndustryIds.includes(industryId)) ||
        (businessTypeId !== null && p.targetBusinessTypeIds.includes(businessTypeId)),
    )
    .map((p) => p.name);
}

/** Deterministic pick for the RULE_BASED path: the first real match, or null if none. */
export function pickDeterministicProductSuggestion(matchingProductNames: string[]): string | null {
  return matchingProductNames.length > 0 ? matchingProductNames[0] : null;
}

/* -------------------------------------------------------------------------
 * Data confidence — documented rule:
 *   Accounts:  HIGH iff the reorder-timing signal is available (>=2 real
 *              orders); otherwise LOW (e.g. an account with only 1 order
 *              has recency but no cadence to compare against).
 *   Prospects: HIGH iff the lead has a real industry AND state on file AND
 *              that combination produced a real product match; otherwise
 *              LOW.
 * ---------------------------------------------------------------------- */

export interface DataConfidenceInput {
  leadType: LeadType;
  hasReorderSignal: boolean;
  hasProductSuggestion: boolean;
  hasIndustryAndState: boolean;
}

export function computeDataConfidence(input: DataConfidenceInput): DataConfidenceLevel {
  if (input.leadType === "accounts") {
    return input.hasReorderSignal ? "HIGH" : "LOW";
  }
  return input.hasIndustryAndState && input.hasProductSuggestion ? "HIGH" : "LOW";
}

/* -------------------------------------------------------------------------
 * Candidate assembly — combines all of the above into one real, fully
 * computed candidate. Still pure/no I/O: every input here must already be
 * real data fetched by the caller (sales-agent.service.ts).
 * ---------------------------------------------------------------------- */

export interface PriorityCandidate {
  leadId: string;
  leadType: LeadType;
  name: string;
  score: number;
  classification: LeadClassification;
  priorityScore: number;
  priority: DailyPriorityLevel;
  deterministicReasons: string[];
  /** Real product names whose target industry/business type match this lead — the only names the AI is allowed to choose from. */
  candidateProductNames: string[];
  deterministicProductSuggestion: string | null;
  dataConfidence: DataConfidenceLevel;
}

export interface AssembleCandidateInput {
  leadId: string;
  leadType: LeadType;
  name: string;
  /** Copied verbatim from the lead's existing LeadScore — never recomputed. */
  score: number;
  classification: LeadClassification;
  industryId: string | null;
  businessTypeId: string | null;
  stateId: string | null;
  recencyDays: number | null;
  averageOrderValue: number | null;
  productFitScore: number;
  stateAlignment: StateAlignment;
  /** Real SalesRecord order dates (Accounts only; always [] for Prospects). */
  orderDates: Date[];
  /** Real value of the most recent order (Accounts only). */
  latestOrderValue: number | null;
  /** The company's active products, with their real target industry/business-type ids. */
  candidateProducts: ProductCandidate[];
}

export function assemblePriorityCandidate(input: AssembleCandidateInput): PriorityCandidate {
  const { averageReorderIntervalDays, overdueByDays } = computeReorderTiming({
    orderDates: input.orderDates,
    recencyDays: input.recencyDays,
  });

  const priorityScore = computePriorityScore({
    classification: input.classification,
    score: input.score,
    overdueByDays,
  });
  const priority = bucketPriority(priorityScore);

  const candidateProductNames = findMatchingProductNames(input.candidateProducts, input.industryId, input.businessTypeId);
  const deterministicProductSuggestion = pickDeterministicProductSuggestion(candidateProductNames);

  const deterministicReasons = buildDeterministicReasons({
    classification: input.classification,
    score: input.score,
    overdueByDays,
    averageReorderIntervalDays,
    latestOrderValue: input.latestOrderValue,
    averageOrderValue: input.averageOrderValue,
    productFitScore: input.productFitScore,
    stateAlignment: input.stateAlignment,
  });

  const dataConfidence = computeDataConfidence({
    leadType: input.leadType,
    hasReorderSignal: averageReorderIntervalDays !== null,
    hasProductSuggestion: deterministicProductSuggestion !== null,
    hasIndustryAndState: Boolean(input.industryId) && Boolean(input.stateId),
  });

  return {
    leadId: input.leadId,
    leadType: input.leadType,
    name: input.name,
    score: input.score,
    classification: input.classification,
    priorityScore,
    priority,
    deterministicReasons,
    candidateProductNames,
    deterministicProductSuggestion,
    dataConfidence,
  };
}

/** Ranks candidates by priorityScore descending. Pure, deterministic, stable for equal scores (Array#sort is stable in Node/V8). */
export function rankCandidates<T extends { priorityScore: number }>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => b.priorityScore - a.priorityScore);
}
