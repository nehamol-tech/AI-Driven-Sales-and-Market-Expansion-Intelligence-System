import type { ProductCandidate, StateProfile } from "./state-profile.service.js";

/* -------------------------------------------------------------------------
 * Product/industry expansion hypothesis candidates — pure, deterministic,
 * no AI, no I/O. Produces only the real candidate PAIRINGS (which product,
 * which real source state it's proven in, which real industry matches in
 * the state being viewed); the actual hedged sentence (`statement`) is
 * filled in later by the narrative pipeline (AI or RULE_BASED template) in
 * market-expansion.service.ts — this module never invents the pairing
 * itself, only surfaces real ones.
 * ---------------------------------------------------------------------- */

/** Caps how many hypothesis candidates are generated per state — keeps the narrated prompt small and avoids drowning a state's real signal in speculation. */
export const MARKET_MAX_HYPOTHESES_PER_STATE = 2;
/** How many of a state's own top real products (by totalValue) count as "proven" enough in that state to seed a cross-state hypothesis elsewhere. */
export const MARKET_PROVEN_PRODUCTS_PER_STATE = 2;
/** A target state already has this many (or more) real orders of a given product — suggesting it there isn't a real whitespace hypothesis anymore, it's already happening. */
export const MARKET_HYPOTHESIS_MAX_EXISTING_ORDERS = 1;

export interface ExpansionHypothesisCandidate {
  /** The state being viewed (where this hypothesis would apply). */
  stateId: string;
  productId: string;
  productName: string;
  /** The real state where this product is already proven (top real product by sales value). */
  sourceStateId: string;
  sourceStateName: string;
  /** The real industry, present in the state being viewed, that this product's real target-industry list matches. */
  targetIndustryId: string;
  targetIndustryName: string;
}

/**
 * For every state with real evidence (INSUFFICIENT_DATA states are skipped —
 * nothing to hypothesize about with zero internal evidence), looks at every
 * OTHER state's top 1-2 real products (by real totalValue — "proven
 * products" for that other state) and checks:
 *   1. Does the product's real targetIndustryIds include one of the target
 *      state's real distinctRealIndustryIds? (a real, evidence-backed match)
 *   2. Does the target state NOT already have meaningful real orders of that
 *      product? (otherwise it's not whitespace, it's already happening)
 * If both hold, it's a real, evidence-backed candidate pairing. Capped at
 * MARKET_MAX_HYPOTHESES_PER_STATE per target state.
 */
export function computeExpansionHypothesisCandidates(
  profiles: StateProfile[],
  products: ProductCandidate[],
): Map<string, ExpansionHypothesisCandidate[]> {
  const productById = new Map(products.map((p) => [p.id, p]));

  const provenByState = new Map<string, { productId: string; productName: string }[]>();
  for (const p of profiles) {
    provenByState.set(
      p.stateId,
      p.productBreakdown.slice(0, MARKET_PROVEN_PRODUCTS_PER_STATE).map((pb) => ({ productId: pb.productId, productName: pb.productName })),
    );
  }

  const result = new Map<string, ExpansionHypothesisCandidate[]>();

  for (const targetState of profiles) {
    const hasEvidence = targetState.accountCount > 0 || targetState.prospectCount > 0 || targetState.orderCount > 0;
    if (!hasEvidence) continue;

    const targetIndustryIds = new Set(targetState.distinctRealIndustryIds);
    const industryNameById = new Map(targetState.industryBreakdown.map((i) => [i.industryId, i.industryName]));
    const existingOrdersByProduct = new Map(targetState.productBreakdown.map((pb) => [pb.productId, pb.orderCount]));

    const candidates: ExpansionHypothesisCandidate[] = [];

    for (const sourceState of profiles) {
      if (candidates.length >= MARKET_MAX_HYPOTHESES_PER_STATE) break;
      if (sourceState.stateId === targetState.stateId) continue;

      const proven = provenByState.get(sourceState.stateId) ?? [];
      for (const prod of proven) {
        if (candidates.length >= MARKET_MAX_HYPOTHESES_PER_STATE) break;
        if (candidates.some((c) => c.productId === prod.productId)) continue; // never suggest the same product twice for one target state

        const existingOrders = existingOrdersByProduct.get(prod.productId) ?? 0;
        if (existingOrders > MARKET_HYPOTHESIS_MAX_EXISTING_ORDERS) continue; // already real orders here — not whitespace

        const product = productById.get(prod.productId);
        if (!product) continue;
        const matchedIndustryId = product.targetIndustryIds.find((id) => targetIndustryIds.has(id));
        if (!matchedIndustryId) continue; // no real industry match in the target state

        candidates.push({
          stateId: targetState.stateId,
          productId: prod.productId,
          productName: prod.productName,
          sourceStateId: sourceState.stateId,
          sourceStateName: sourceState.stateName,
          targetIndustryId: matchedIndustryId,
          targetIndustryName: industryNameById.get(matchedIndustryId) ?? "Unknown industry",
        });
      }
    }

    if (candidates.length > 0) result.set(targetState.stateId, candidates);
  }

  return result;
}

/**
 * Deterministic, always-hedged fallback statement — used as the RULE_BASED
 * template when the AI narrative pipeline is unavailable or invalid. Never
 * phrased as proven demand.
 */
export function buildRuleBasedHypothesisStatement(candidate: ExpansionHypothesisCandidate): string {
  return `${candidate.targetIndustryName} accounts may be worth investigating for ${candidate.productName}, which performs well in ${candidate.sourceStateName}.`;
}
