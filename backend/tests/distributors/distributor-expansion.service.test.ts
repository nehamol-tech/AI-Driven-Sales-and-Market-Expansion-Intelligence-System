import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";
import {
  computeExpansionRecommendations,
  computeDistributorPerformance,
  runDistributorExpansionNarrativePipeline,
  getDistributorExpansionSummary,
  clearDistributorExpansionCache,
  EXPANSION_RECOMMENDATION_LIMIT,
  type DistributorExpansionPrismaDeps,
} from "../../src/modules/distributors/distributor-expansion.service.js";
import type { DistributorExpansionEvidence } from "../../src/modules/distributors/distributor-expansion.prompt.js";

const NOW = new Date("2026-08-17T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function makeFakeAIProvider(responses: (string | Error)[]): AIProvider {
  let call = 0;
  return {
    name: "fake",
    async generateCompletion(): Promise<AIProviderCompletion> {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (response instanceof Error) throw response;
      return { content: response, usage: undefined };
    },
  };
}

function validNarrativeJson(text = "A real narrative from the given evidence."): string {
  return JSON.stringify({ narrative: text });
}

/* =========================================================================
 * Real-data builders that feed gatherStateProfiles + scoreState (Phase 4's
 * ACTUAL exported functions — never reimplemented here). Recipes mirror
 * market-scoring.test.ts's proven "strong"/"weak" profiles so classification
 * outcomes are trustworthy, not guessed.
 * ========================================================================= */

const IND_MFG = "ind_mfg";
const PROD_A = "prod_a";

/**
 * A "strong" state (mirrors market-scoring.test.ts's strongProfile recipe):
 * 10 accounts (8 HOT / 2 WARM) all in one industry, 8 real orders spanning
 * >60 days with strong recent-vs-prior growth, matched by 2 active products
 * targeting that industry. Classifies HIGH_OPPORTUNITY. `scaleFactor` scales
 * every order value uniformly (growth%/industryFit ratios are scale-
 * invariant, so only existingDemand — and thus the final score — varies with
 * it), letting tests build many distinctly-ranked HIGH_OPPORTUNITY states.
 */
function makeStrongStateRows(stateId: string, scaleFactor = 1) {
  const accounts = Array.from({ length: 10 }, (_, i) => ({ id: `${stateId}_acc_${i}`, stateId, industryId: IND_MFG }));
  const leadScores = accounts.map((a, i) => ({ accountId: a.id, classification: i < 8 ? "HOT" : "WARM" }));
  const baseValues = [200_000, 200_000, 200_000, 200_000, 50_000, 50_000, 50_000, 50_000];
  const baseDays = [10, 20, 30, 40, 70, 80, 90, 100];
  const salesRecords = baseValues.map((v, i) => ({
    stateId,
    cityId: null,
    industryId: IND_MFG,
    productId: PROD_A,
    date: daysAgo(baseDays[i]),
    orderValue: v * scaleFactor,
    city: null,
    industry: { name: "Manufacturing" },
    product: { name: "Product A" },
  }));
  return { accounts, leadScores, salesRecords };
}

/** A "medium" state: weaker on every dimension, lands in MEDIUM_OPPORTUNITY (30-59) per classifyMarket's thresholds. */
function makeMediumStateRows(stateId: string) {
  const accounts = [
    { id: `${stateId}_acc_0`, stateId, industryId: IND_MFG },
    { id: `${stateId}_acc_1`, stateId, industryId: IND_MFG },
    { id: `${stateId}_acc_2`, stateId, industryId: IND_MFG },
  ];
  const leadScores = [
    { accountId: `${stateId}_acc_0`, classification: "HOT" },
    { accountId: `${stateId}_acc_1`, classification: "WARM" },
  ];
  const salesRecords = [150_000, 150_000].map((v, i) => ({
    stateId,
    cityId: null,
    industryId: IND_MFG,
    productId: PROD_A,
    date: daysAgo(5 + i * 5),
    orderValue: v,
    city: null,
    industry: { name: "Manufacturing" },
    product: { name: "Product A" },
  }));
  return { accounts, leadScores, salesRecords };
}

/** A "weak" state: one account, zero orders, zero score -> EMERGING (has evidence, but score 0). */
function makeWeakStateRows(stateId: string) {
  const accounts = [{ id: `${stateId}_acc_0`, stateId, industryId: null }];
  return { accounts, leadScores: [] as { accountId: string; classification: string }[], salesRecords: [] as unknown[] };
}

const PRODUCTS = [
  { id: "p1", name: "Product A", isActive: true, targetIndustries: [{ industryId: IND_MFG }] },
  { id: "p2", name: "Product B", isActive: true, targetIndustries: [{ industryId: IND_MFG }] },
];

interface BuildDepsOptions {
  states: { id: string; name: string }[];
  accounts: { id: string; stateId: string; industryId: string | null }[];
  leadScores: { accountId: string; classification: string }[];
  salesRecords: unknown[];
  /** stateId -> ACTIVE/INACTIVE coverage rows. */
  territories?: { stateId: string; distributorStatus: "ACTIVE" | "INACTIVE" | "PROSPECTIVE" }[];
  distributors?: { id: string; name: string; type: string }[];
  salesByDistributor?: { distributorId: string; sum: number; count: number }[];
}

function buildDeps(opts: BuildDepsOptions): DistributorExpansionPrismaDeps {
  const territories = opts.territories ?? [];
  const distributors = opts.distributors ?? [];
  const salesByDistributor = opts.salesByDistributor ?? [];

  return {
    state: { findMany: vi.fn(async () => opts.states) },
    account: { findMany: vi.fn(async () => opts.accounts) },
    prospect: { findMany: vi.fn(async () => []) },
    leadScore: { findMany: vi.fn(async () => opts.leadScores) },
    product: { findMany: vi.fn(async () => PRODUCTS) },
    salesRecord: {
      findMany: vi.fn(async () => opts.salesRecords),
      groupBy: vi.fn(async () => salesByDistributor.map((s) => ({ distributorId: s.distributorId, _sum: { orderValue: s.sum }, _count: { _all: s.count } }))),
    },
    distributor: { findMany: vi.fn(async () => distributors) },
    distributorTerritory: {
      findMany: vi.fn(async () => territories.filter((t) => t.distributorStatus === "ACTIVE").map((t) => ({ stateId: t.stateId }))),
    },
  };
}

/* -------------------------------------------------------------------------
 * computeExpansionRecommendations — real integration with Phase 4's
 * gatherStateProfiles/scoreState, never a reimplemented stand-in.
 * ---------------------------------------------------------------------- */

describe("computeExpansionRecommendations", () => {
  it("includes zero-coverage HIGH/MEDIUM_OPPORTUNITY states, excludes covered/INSUFFICIENT_DATA/EMERGING states, sorted score desc", async () => {
    const strong = makeStrongStateRows("st_strong");
    const covered = makeStrongStateRows("st_covered"); // identical strong recipe, but has ACTIVE coverage
    const medium = makeMediumStateRows("st_medium");
    const weak = makeWeakStateRows("st_weak");

    const deps = buildDeps({
      states: [
        { id: "st_strong", name: "Maharashtra" },
        { id: "st_covered", name: "Kerala" },
        { id: "st_medium", name: "Gujarat" },
        { id: "st_weak", name: "Goa" },
        { id: "st_empty", name: "Bihar" }, // zero accounts/prospects/orders -> INSUFFICIENT_DATA
      ],
      accounts: [...strong.accounts, ...covered.accounts, ...medium.accounts, ...weak.accounts],
      leadScores: [...strong.leadScores, ...covered.leadScores, ...medium.leadScores],
      salesRecords: [...strong.salesRecords, ...covered.salesRecords, ...medium.salesRecords],
      territories: [{ stateId: "st_covered", distributorStatus: "ACTIVE" }],
    });

    const result = await computeExpansionRecommendations(deps, "c1", NOW);

    const stateIds = result.map((r) => r.stateId);
    expect(stateIds).toContain("st_strong");
    expect(stateIds).toContain("st_medium");
    expect(stateIds).not.toContain("st_covered"); // HIGH_OPPORTUNITY but already covered
    expect(stateIds).not.toContain("st_weak"); // EMERGING
    expect(stateIds).not.toContain("st_empty"); // INSUFFICIENT_DATA

    // Every returned recommendation has distributorCoverageCount 0, by construction.
    expect(result.every((r) => r.distributorCoverageCount === 0)).toBe(true);

    // st_strong (HIGH_OPPORTUNITY, higher score) ranks above st_medium (MEDIUM_OPPORTUNITY).
    const strongEntry = result.find((r) => r.stateId === "st_strong")!;
    const mediumEntry = result.find((r) => r.stateId === "st_medium")!;
    expect(strongEntry.opportunityClassification).toBe("HIGH_OPPORTUNITY");
    expect(mediumEntry.opportunityClassification).toBe("MEDIUM_OPPORTUNITY");
    expect(strongEntry.opportunityScore).toBeGreaterThan(mediumEntry.opportunityScore);
    expect(result.indexOf(strongEntry)).toBeLessThan(result.indexOf(mediumEntry));
  });

  it("INACTIVE distributor territory coverage does not exclude a state (only ACTIVE counts as real coverage)", async () => {
    const strong = makeStrongStateRows("st_strong");
    const deps = buildDeps({
      states: [{ id: "st_strong", name: "Maharashtra" }],
      accounts: strong.accounts,
      leadScores: strong.leadScores,
      salesRecords: strong.salesRecords,
      territories: [{ stateId: "st_strong", distributorStatus: "INACTIVE" }],
    });

    const result = await computeExpansionRecommendations(deps, "c1", NOW);
    expect(result.map((r) => r.stateId)).toContain("st_strong");
  });

  it(`respects EXPANSION_RECOMMENDATION_LIMIT (${EXPANSION_RECOMMENDATION_LIMIT}), keeping only the top-scored states`, async () => {
    const stateCount = EXPANSION_RECOMMENDATION_LIMIT + 2;
    const states = Array.from({ length: stateCount }, (_, i) => ({ id: `st_${i}`, name: `State ${i}` }));
    // Distinct, monotonically decreasing scale factors -> distinct, monotonically decreasing scores (see makeStrongStateRows's doc comment).
    const rowsPerState = states.map((s, i) => makeStrongStateRows(s.id, (1_000_000 - i * 10_000) / 1_000_000));

    const deps = buildDeps({
      states,
      accounts: rowsPerState.flatMap((r) => r.accounts),
      leadScores: rowsPerState.flatMap((r) => r.leadScores),
      salesRecords: rowsPerState.flatMap((r) => r.salesRecords),
    });

    const result = await computeExpansionRecommendations(deps, "c1", NOW);

    expect(result).toHaveLength(EXPANSION_RECOMMENDATION_LIMIT);
    expect(result.every((r) => r.opportunityClassification === "HIGH_OPPORTUNITY")).toBe(true);
    // Sorted score desc.
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].opportunityScore).toBeGreaterThanOrEqual(result[i].opportunityScore);
    }
    // The top-scored states are st_0..st_9 (highest totalSalesValue first); st_10/st_11 (lowest) are dropped.
    expect(result.map((r) => r.stateId)).toEqual(states.slice(0, EXPANSION_RECOMMENDATION_LIMIT).map((s) => s.id));
  });

  it("returns an empty array when no state qualifies (all covered, or all INSUFFICIENT_DATA/EMERGING)", async () => {
    const strong = makeStrongStateRows("st_strong");
    const deps = buildDeps({
      states: [
        { id: "st_strong", name: "Maharashtra" },
        { id: "st_empty", name: "Bihar" },
      ],
      accounts: strong.accounts,
      leadScores: strong.leadScores,
      salesRecords: strong.salesRecords,
      territories: [{ stateId: "st_strong", distributorStatus: "ACTIVE" }], // the only real-opportunity state is fully covered
    });

    const result = await computeExpansionRecommendations(deps, "c1", NOW);
    expect(result).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * computeDistributorPerformance
 * ---------------------------------------------------------------------- */

describe("computeDistributorPerformance", () => {
  it("sums real revenue/order count per distributor via one batched groupBy", async () => {
    const deps = buildDeps({
      states: [],
      accounts: [],
      leadScores: [],
      salesRecords: [],
      distributors: [
        { id: "d1", name: "Acme Distribution", type: "DISTRIBUTOR" },
        { id: "d2", name: "Beta Dealer", type: "DEALER" },
      ],
      salesByDistributor: [{ distributorId: "d1", sum: 50_000, count: 4 }],
    });

    const result = await computeDistributorPerformance(deps, "c1");

    expect(result).toHaveLength(2);
    const d1 = result.find((r) => r.distributorId === "d1")!;
    expect(d1.totalRevenue).toBe("50000");
    expect(d1.orderCount).toBe(4);
  });

  it("a distributor with zero linked sales still appears with totalRevenue '0' and orderCount 0 — never omitted", async () => {
    const deps = buildDeps({
      states: [],
      accounts: [],
      leadScores: [],
      salesRecords: [],
      distributors: [{ id: "d2", name: "No Sales Yet Co", type: "DEALER" }],
      salesByDistributor: [], // no groupBy rows for d2
    });

    const result = await computeDistributorPerformance(deps, "c1");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ distributorId: "d2", name: "No Sales Yet Co", type: "DEALER", totalRevenue: "0", orderCount: 0 });
  });

  it("zero distributors -> empty array, no groupBy call", async () => {
    const deps = buildDeps({ states: [], accounts: [], leadScores: [], salesRecords: [], distributors: [] });
    const result = await computeDistributorPerformance(deps, "c1");
    expect(result).toEqual([]);
    expect(deps.salesRecord.groupBy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------
 * runDistributorExpansionNarrativePipeline — AI/fallback pipeline, mirrors
 * advertising-analytics.service.test.ts's shape exactly.
 * ---------------------------------------------------------------------- */

function makeEvidence(overrides: Partial<DistributorExpansionEvidence> = {}): DistributorExpansionEvidence {
  return {
    recommendations: [{ stateId: "st_1", stateName: "Maharashtra", opportunityScore: 80, opportunityClassification: "HIGH_OPPORTUNITY", distributorCoverageCount: 0 }],
    performance: [{ distributorId: "d1", name: "Acme Distribution", type: "DISTRIBUTOR", totalRevenue: "50000", orderCount: 4 }],
    ...overrides,
  };
}

describe("runDistributorExpansionNarrativePipeline", () => {
  it("returns an AI-narrated result on success", async () => {
    const provider = makeFakeAIProvider([validNarrativeJson("Great real narrative.")]);
    const result = await runDistributorExpansionNarrativePipeline(provider, makeEvidence());
    expect(result.method).toBe("AI");
    expect(result.narrative).toBe("Great real narrative.");
  });

  it("retries once on malformed JSON, then succeeds if the retry is valid", async () => {
    const provider = makeFakeAIProvider(["not json at all", validNarrativeJson()]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runDistributorExpansionNarrativePipeline(provider, makeEvidence());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("AI");
  });

  it("falls back to RULE_BASED when the AI keeps returning malformed JSON after one retry", async () => {
    const provider = makeFakeAIProvider(["not json", "still not valid"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runDistributorExpansionNarrativePipeline(provider, makeEvidence());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
    expect(result.narrative).not.toBeNull();
  });

  it("falls back to RULE_BASED when the AI throws on both attempts", async () => {
    const provider = makeFakeAIProvider([new Error("network error"), new Error("network error")]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runDistributorExpansionNarrativePipeline(provider, makeEvidence());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
  });

  it("skips the AI call entirely and returns narrative: null when there are zero recommendations AND zero distributors", async () => {
    const provider = makeFakeAIProvider(["should never be used"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runDistributorExpansionNarrativePipeline(provider, makeEvidence({ recommendations: [], performance: [] }));
    expect(spy).not.toHaveBeenCalled();
    expect(result.narrative).toBeNull();
    expect(result.method).toBe("RULE_BASED");
  });

  it("still calls the AI when there are recommendations but zero distributors", async () => {
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runDistributorExpansionNarrativePipeline(provider, makeEvidence({ performance: [] }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.method).toBe("AI");
  });
});

/* -------------------------------------------------------------------------
 * getDistributorExpansionSummary — cache/force orchestration.
 * ---------------------------------------------------------------------- */

describe("getDistributorExpansionSummary orchestration", () => {
  beforeEach(() => {
    clearDistributorExpansionCache();
  });

  function makeOrchestrationDeps(): DistributorExpansionPrismaDeps {
    return buildDeps({ states: [], accounts: [], leadScores: [], salesRecords: [], distributors: [] });
  }

  it("caches the generated result for the rest of the day — a second same-day call does not re-hit the DB or re-call AI", async () => {
    const deps = makeOrchestrationDeps();
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const aiSpy = vi.spyOn(provider, "generateCompletion");

    const first = await getDistributorExpansionSummary(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(first.wasGenerated).toBe(true);
    expect(deps.state.findMany).toHaveBeenCalledTimes(1);

    const second = await getDistributorExpansionSummary(deps, provider, { companyId: "c1", force: false, now: new Date(NOW.getTime() + 3 * 60 * 60 * 1000) });
    expect(second.wasGenerated).toBe(false);
    expect(deps.state.findMany).toHaveBeenCalledTimes(1);
    expect(aiSpy).toHaveBeenCalledTimes(0); // zero recommendations + zero distributors -> zero AI calls either time
  });

  it("force=true bypasses the cache and regenerates", async () => {
    const deps = makeOrchestrationDeps();
    const provider = makeFakeAIProvider([validNarrativeJson()]);

    await getDistributorExpansionSummary(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(deps.state.findMany).toHaveBeenCalledTimes(1);

    const forced = await getDistributorExpansionSummary(deps, provider, { companyId: "c1", force: true, now: NOW });
    expect(forced.wasGenerated).toBe(true);
    expect(deps.state.findMany).toHaveBeenCalledTimes(2);
  });

  it("zero recommendations and zero distributors -> narrative null, RULE_BASED method", async () => {
    const deps = makeOrchestrationDeps();
    const provider = makeFakeAIProvider(["should never be used"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await getDistributorExpansionSummary(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(spy).not.toHaveBeenCalled();
    expect(result.recommendations).toEqual([]);
    expect(result.performance).toEqual([]);
    expect(result.narrative).toBeNull();
    expect(result.narrativeMethod).toBe("RULE_BASED");
  });
});
