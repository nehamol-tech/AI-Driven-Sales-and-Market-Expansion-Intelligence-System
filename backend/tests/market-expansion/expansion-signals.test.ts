import { describe, it, expect } from "vitest";
import {
  buildRuleBasedHypothesisStatement,
  computeExpansionHypothesisCandidates,
  MARKET_HYPOTHESIS_MAX_EXISTING_ORDERS,
  MARKET_MAX_HYPOTHESES_PER_STATE,
} from "../../src/modules/market-expansion/expansion-signals.js";
import type { ProductCandidate, StateProfile } from "../../src/modules/market-expansion/state-profile.service.js";

function makeProfile(overrides: Partial<StateProfile> = {}): StateProfile {
  return {
    stateId: "st_1",
    stateName: "State One",
    accountCount: 0,
    prospectCount: 0,
    orderCount: 0,
    totalSalesValue: 0,
    averageOrderValue: null,
    hotAccountCount: 0,
    warmAccountCount: 0,
    industryBreakdown: [],
    topIndustry: null,
    cityBreakdown: [],
    productBreakdown: [],
    orders: [],
    distinctRealIndustryIds: [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * Test #6 — the hypothesis engine only ever references a real
 * product/state/industry triple that genuinely exists in the fixture data;
 * it never invents a pairing.
 * ---------------------------------------------------------------------- */

describe("computeExpansionHypothesisCandidates (test #6)", () => {
  const products: ProductCandidate[] = [
    { id: "prod_a", name: "Product A", targetIndustryIds: ["ind_mfg"] },
    { id: "prod_b", name: "Product B", targetIndustryIds: ["ind_retail"] },
  ];

  const karnataka = makeProfile({
    stateId: "st_ka",
    stateName: "Karnataka",
    accountCount: 5,
    orderCount: 4,
    totalSalesValue: 400_000,
    productBreakdown: [{ productId: "prod_a", productName: "Product A", orderCount: 4, totalValue: 400_000 }],
    distinctRealIndustryIds: ["ind_mfg"],
    industryBreakdown: [{ industryId: "ind_mfg", industryName: "Manufacturing", accountCount: 5, orderCount: 4, totalValue: 400_000 }],
  });

  const tamilNadu = makeProfile({
    stateId: "st_tn",
    stateName: "Tamil Nadu",
    accountCount: 2,
    orderCount: 0,
    productBreakdown: [], // no real orders of Product A here yet
    distinctRealIndustryIds: ["ind_mfg"], // real match with Product A's real target industry
    industryBreakdown: [{ industryId: "ind_mfg", industryName: "Manufacturing", accountCount: 2, orderCount: 0, totalValue: 0 }],
  });

  const emptyState = makeProfile({ stateId: "st_empty", stateName: "Empty State", accountCount: 0, prospectCount: 0, orderCount: 0 });

  it("produces a real, evidence-backed candidate: a product proven in one state, matching a real industry in another", () => {
    const result = computeExpansionHypothesisCandidates([karnataka, tamilNadu], products);
    const tnCandidates = result.get("st_tn") ?? [];
    expect(tnCandidates).toHaveLength(1);
    expect(tnCandidates[0]).toEqual({
      stateId: "st_tn",
      productId: "prod_a",
      productName: "Product A",
      sourceStateId: "st_ka",
      sourceStateName: "Karnataka",
      targetIndustryId: "ind_mfg",
      targetIndustryName: "Manufacturing",
    });
  });

  it("never invents a candidate for a state that has no real evidence at all (INSUFFICIENT_DATA states are skipped)", () => {
    const result = computeExpansionHypothesisCandidates([karnataka, emptyState], products);
    expect(result.has("st_empty")).toBe(false);
  });

  it("does not suggest a product whose real target industries don't match anything real in the target state", () => {
    const otherState = makeProfile({
      stateId: "st_other",
      stateName: "Other State",
      accountCount: 1,
      distinctRealIndustryIds: ["ind_hospitality"], // no product targets this industry
      industryBreakdown: [{ industryId: "ind_hospitality", industryName: "Hospitality", accountCount: 1, orderCount: 0, totalValue: 0 }],
    });
    const result = computeExpansionHypothesisCandidates([karnataka, otherState], products);
    expect(result.has("st_other")).toBe(false);
  });

  it("does not suggest a product the target state already has meaningful real orders of (not real whitespace)", () => {
    const saturatedTN = makeProfile({
      ...tamilNadu,
      productBreakdown: [{ productId: "prod_a", productName: "Product A", orderCount: MARKET_HYPOTHESIS_MAX_EXISTING_ORDERS + 5, totalValue: 50_000 }],
    });
    const result = computeExpansionHypothesisCandidates([karnataka, saturatedTN], products);
    expect(result.has("st_tn")).toBe(false);
  });

  it("caps candidates at MARKET_MAX_HYPOTHESES_PER_STATE even with many real matching source states", () => {
    const sourceStates = ["a", "b", "c", "d"].map((suffix, i) =>
      makeProfile({
        stateId: `st_src_${suffix}`,
        stateName: `Source ${suffix}`,
        accountCount: 3,
        orderCount: 2,
        productBreakdown: [{ productId: `prod_${suffix}`, productName: `Product ${suffix.toUpperCase()}`, orderCount: 2, totalValue: 10_000 * (i + 1) }],
        distinctRealIndustryIds: ["ind_mfg"],
      }),
    );
    const productsForFour: ProductCandidate[] = ["a", "b", "c", "d"].map((suffix) => ({ id: `prod_${suffix}`, name: `Product ${suffix.toUpperCase()}`, targetIndustryIds: ["ind_mfg"] }));

    const result = computeExpansionHypothesisCandidates([...sourceStates, tamilNadu], productsForFour);
    const tnCandidates = result.get("st_tn") ?? [];
    expect(tnCandidates.length).toBeLessThanOrEqual(MARKET_MAX_HYPOTHESES_PER_STATE);
  });

  it("never suggests a state's own product back to itself", () => {
    const result = computeExpansionHypothesisCandidates([karnataka], products);
    expect(result.has("st_ka")).toBe(false); // Karnataka can't be its own "source state" for its own proven product
  });
});

describe("buildRuleBasedHypothesisStatement", () => {
  it("produces a hedged sentence referencing the real product, source state, and target industry — never phrased as proven demand", () => {
    const statement = buildRuleBasedHypothesisStatement({
      stateId: "st_tn",
      productId: "prod_a",
      productName: "Product A",
      sourceStateId: "st_ka",
      sourceStateName: "Karnataka",
      targetIndustryId: "ind_mfg",
      targetIndustryName: "Manufacturing",
    });
    expect(statement).toContain("Product A");
    expect(statement).toContain("Karnataka");
    expect(statement).toContain("Manufacturing");
    expect(statement).toMatch(/may be worth investigating/i);
    expect(statement.toLowerCase()).not.toContain("proven demand");
    expect(statement.toLowerCase()).not.toContain("guaranteed");
  });
});
