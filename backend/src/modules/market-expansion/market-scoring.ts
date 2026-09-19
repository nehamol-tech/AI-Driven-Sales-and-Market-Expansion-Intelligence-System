import type { MarketGrowthSignal, MarketOpportunityClassification } from "@ai-sales/shared";
import { computeWindowComparison } from "../opportunities/account-profile.service.js";
import type { ProductCandidate, StateProfile } from "./state-profile.service.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* =========================================================================
 * Every function below is PURE: no AI, no I/O. All thresholds are named,
 * exported constants with a documented rationale, centralized here per the
 * spec's explicit "centralize all weights/constants in one place"
 * instruction. Every sub-score is self-calibrated against this company's own
 * real data (never a guessed absolute rupee/count threshold) — mirrors
 * detectors.ts's computeTopValueAccounts relative-ranking philosophy.
 * ========================================================================= */

/* -------------------------------------------------------------------------
 * 1. Existing demand — this state's real sales value relative to the
 * strongest real state the company already has. A state with zero orders
 * gets 0 regardless of anything else; division by zero is guarded (if no
 * state anywhere has any orders yet, every state's demand score is 0).
 * ---------------------------------------------------------------------- */

export function computeExistingDemandScore(state: StateProfile, maxTotalSalesValueAcrossStatesWithOrders: number): number {
  if (state.orderCount === 0) return 0;
  if (maxTotalSalesValueAcrossStatesWithOrders <= 0) return 0;
  return Math.min(100, (state.totalSalesValue / maxTotalSalesValueAcrossStatesWithOrders) * 100);
}

/** Computes the real max total sales value across every state that has at least one order — the denominator for computeExistingDemandScore. */
export function computeMaxTotalSalesValueAcrossStatesWithOrders(profiles: StateProfile[]): number {
  return profiles.reduce((max, p) => (p.orderCount > 0 ? Math.max(max, p.totalSalesValue) : max), 0);
}

/* -------------------------------------------------------------------------
 * 2. Customer quality — rewards a state whose real accounts skew HOT/WARM.
 * Formula: ((hot*2 + warm) / accountCount) * WEIGHT.
 *   - An all-HOT state: (n*2/n) = 2, so WEIGHT=50 maps it to 100.
 *   - An all-WARM state: (n*1/n) = 1, so WEIGHT=50 maps it to 50.
 *   - A state with only COLD/AT_RISK-classified accounts contributes 0 (no
 *     credit for volume alone — this sub-score is about REAL lead quality,
 *     not headcount; existingDemand/whitespace already reward headcount).
 * 0 when accountCount === 0 (nothing to grade).
 * ---------------------------------------------------------------------- */

/** Maps an all-HOT state to ~100 (see formula rationale above). */
export const MARKET_CUSTOMER_QUALITY_WEIGHT = 50;

export function computeCustomerQualityScore(state: StateProfile): number {
  if (state.accountCount === 0) return 0;
  const raw = ((state.hotAccountCount * 2 + state.warmAccountCount) / state.accountCount) * MARKET_CUSTOMER_QUALITY_WEIGHT;
  return Math.min(100, raw);
}

/* -------------------------------------------------------------------------
 * 3. Product fit — what fraction of the company's real active products have
 * at least one real targetIndustryId matching one of this state's real
 * distinctRealIndustryIds. (targetBusinessTypeId is deliberately NOT part of
 * this match: SalesRecord — this feature's only real per-transaction
 * geographic signal — has no businessTypeId column, so there is no real,
 * evidence-backed "distinct business types present in this state" to match
 * against; Prospect.businessTypeId exists but isn't part of the per-state
 * evidence gathered in step 2 of the spec. This is a deliberate, documented
 * narrowing versus detectors.ts's account-level matchCriteriaCount, which
 * does have both dimensions available.)
 * 0 when the state has no real industries represented yet (nothing to match
 * against) or the company has no active products.
 * ---------------------------------------------------------------------- */

export function computeMatchingProductCount(distinctRealIndustryIds: string[], products: ProductCandidate[]): number {
  if (distinctRealIndustryIds.length === 0) return 0;
  const industrySet = new Set(distinctRealIndustryIds);
  return products.filter((p) => p.targetIndustryIds.some((id) => industrySet.has(id))).length;
}

export function computeProductFitScore(state: StateProfile, totalActiveProductCount: number, matchingProductCount: number): number {
  if (state.distinctRealIndustryIds.length === 0) return 0;
  if (totalActiveProductCount === 0) return 0;
  return (matchingProductCount / totalActiveProductCount) * 100;
}

/* -------------------------------------------------------------------------
 * 4. Industry fit — how concentrated/strong the state's top real industry
 * is, as a fraction of the state's own total real sales value. 0 when the
 * state has no real orders.
 * ---------------------------------------------------------------------- */

export function computeIndustryFitScore(state: StateProfile): number {
  if (state.orderCount === 0 || !state.topIndustry || state.totalSalesValue <= 0) return 0;
  return Math.min(100, (state.topIndustry.totalValue / state.totalSalesValue) * 100);
}

/* -------------------------------------------------------------------------
 * 5. Growth — reuses computeWindowComparison directly (Phase 3C's own
 * generic two-window helper, not reimplemented). Requires the same kind of
 * real-data gates Phase 3C's AT_RISK/GROWING use: enough real orders,
 * spanning enough real days, AND real prior-window activity to compare
 * against — otherwise there is nothing honest to report and the signal is
 * "insufficient_data", never a guessed trend. When not computable, this
 * sub-score contributes 0 to the weighted sum (not excluded/reweighted —
 * simplest, and documented here as the chosen behavior, not a bug).
 * ---------------------------------------------------------------------- */

/** 60 days — reuses Phase 3C's AT_RISK_WINDOW_DAYS/GROWING_WINDOW_DAYS value for consistency across features. */
export const MARKET_GROWTH_WINDOW_DAYS = 60;
/** Mirrors Phase 3C's AT_RISK_MIN_TOTAL_ORDERS — below this many total real orders, a two-period trend comparison isn't meaningful. */
export const MARKET_GROWTH_MIN_ORDERS = 3;
/** Mirrors Phase 3C's AT_RISK_MIN_SPAN_DAYS/GROWING_MIN_SPAN_DAYS — the state's real order history must span at least this long for "growth" to mean something beyond noise. */
export const MARKET_GROWTH_MIN_SPAN_DAYS = 60;

export interface GrowthComputation {
  score: number;
  signal: MarketGrowthSignal;
}

export function computeGrowth(state: StateProfile, now: Date): GrowthComputation {
  if (state.orders.length < MARKET_GROWTH_MIN_ORDERS) {
    return { score: 0, signal: { status: "insufficient_data" } };
  }

  const dates = state.orders.map((o) => o.date.getTime());
  const spanDays = (Math.max(...dates) - Math.min(...dates)) / MS_PER_DAY;
  if (spanDays < MARKET_GROWTH_MIN_SPAN_DAYS) {
    return { score: 0, signal: { status: "insufficient_data" } };
  }

  const cmp = computeWindowComparison(state.orders, now, MARKET_GROWTH_WINDOW_DAYS);
  if (cmp.priorValue <= 0) {
    return { score: 0, signal: { status: "insufficient_data" } }; // no real prior activity to compare against
  }

  const growthPct = (cmp.recentValue - cmp.priorValue) / cmp.priorValue;
  const score = Math.min(100, Math.max(0, growthPct * 100));

  return {
    score,
    signal: {
      status: "ok",
      recentValue: String(Math.round(cmp.recentValue)),
      priorValue: String(Math.round(cmp.priorValue)),
      growthPct: Math.round(growthPct * 1000) / 1000,
    },
  };
}

/* -------------------------------------------------------------------------
 * 6. Whitespace — rewards real product/industry fit that ISN'T already
 * saturated with existing accounts. This is what distinguishes an "existing
 * strong market" (high demand AND high accountCount, so whitespace
 * naturally low) from an "underdeveloped market" (real product/industry fit
 * exists but few accounts have captured it yet, so whitespace stays high).
 * ---------------------------------------------------------------------- */

/** Real accounts in a state, at or above which the market is treated as no longer underdeveloped. */
export const MARKET_WHITESPACE_SATURATION_ACCOUNTS = 5;

export function computeWhitespaceScore(productFitScore: number, accountCount: number): number {
  const saturation = Math.min(1, accountCount / MARKET_WHITESPACE_SATURATION_ACCOUNTS);
  return productFitScore * (1 - saturation);
}

/* -------------------------------------------------------------------------
 * Weighted composite + classification.
 * ---------------------------------------------------------------------- */

export const MARKET_SCORE_WEIGHTS = {
  existingDemand: 0.25,
  customerQuality: 0.2,
  productFit: 0.2,
  industryFit: 0.15,
  growth: 0.1,
  whitespace: 0.1,
} as const;

/** >= this composite score (0-100) is a real, strong opportunity. */
export const MARKET_HIGH_THRESHOLD = 60;
/** >= this composite score, below HIGH, is a real but moderate opportunity. */
export const MARKET_MEDIUM_THRESHOLD = 30;

export interface MarketSubScores {
  existingDemand: number;
  customerQuality: number;
  productFit: number;
  industryFit: number;
  growth: number;
  whitespace: number;
}

/**
 * Pure classification: INSUFFICIENT_DATA when there is literally zero real
 * evidence (no accounts, no prospects, no orders) for this state, regardless
 * of score. Otherwise HIGH/MEDIUM/EMERGING purely from the given score.
 * `score` is expected to be null only when classification will resolve to
 * INSUFFICIENT_DATA (the caller is responsible for presenting null in that
 * case — this function tolerates either since it treats a null score as 0
 * for a state that turns out to have real evidence, which never happens in
 * practice given scoreState's own gating).
 */
export function classifyMarket(profile: StateProfile, score: number | null): MarketOpportunityClassification {
  const hasEvidence = profile.accountCount > 0 || profile.prospectCount > 0 || profile.orderCount > 0;
  if (!hasEvidence) return "INSUFFICIENT_DATA";
  const s = score ?? 0;
  if (s >= MARKET_HIGH_THRESHOLD) return "HIGH_OPPORTUNITY";
  if (s >= MARKET_MEDIUM_THRESHOLD) return "MEDIUM_OPPORTUNITY";
  return "EMERGING";
}

export interface MarketScoreContext {
  now: Date;
  maxTotalSalesValueAcrossStatesWithOrders: number;
  totalActiveProductCount: number;
  products: ProductCandidate[];
}

export interface MarketScoreResult {
  /** null only for INSUFFICIENT_DATA — never a guessed number. */
  score: number | null;
  classification: MarketOpportunityClassification;
  subScores: MarketSubScores;
  growthSignal: MarketGrowthSignal;
}

/**
 * marketScore = round(existingDemand*0.25 + customerQuality*0.20 +
 * productFit*0.20 + industryFit*0.15 + growth*0.10 + whitespace*0.10).
 * Computes every sub-score first (always, even for a zero-evidence state —
 * they naturally resolve to 0 and are harmless), then classifies. `score` is
 * presented as null exactly when classifyMarket resolves to
 * INSUFFICIENT_DATA — a real "no data" state is never given a fabricated 0
 * score to imply "we looked and it's the worst."
 */
export function scoreState(state: StateProfile, ctx: MarketScoreContext): MarketScoreResult {
  const existingDemand = computeExistingDemandScore(state, ctx.maxTotalSalesValueAcrossStatesWithOrders);
  const customerQuality = computeCustomerQualityScore(state);
  const matchingProductCount = computeMatchingProductCount(state.distinctRealIndustryIds, ctx.products);
  const productFit = computeProductFitScore(state, ctx.totalActiveProductCount, matchingProductCount);
  const industryFit = computeIndustryFitScore(state);
  const { score: growth, signal: growthSignal } = computeGrowth(state, ctx.now);
  const whitespace = computeWhitespaceScore(productFit, state.accountCount);

  const subScores: MarketSubScores = { existingDemand, customerQuality, productFit, industryFit, growth, whitespace };

  const rawScore =
    existingDemand * MARKET_SCORE_WEIGHTS.existingDemand +
    customerQuality * MARKET_SCORE_WEIGHTS.customerQuality +
    productFit * MARKET_SCORE_WEIGHTS.productFit +
    industryFit * MARKET_SCORE_WEIGHTS.industryFit +
    growth * MARKET_SCORE_WEIGHTS.growth +
    whitespace * MARKET_SCORE_WEIGHTS.whitespace;
  const roundedScore = Math.round(rawScore);

  const classification = classifyMarket(state, roundedScore);
  if (classification === "INSUFFICIENT_DATA") {
    return { score: null, classification, subScores, growthSignal };
  }

  return { score: roundedScore, classification, subScores, growthSignal };
}
