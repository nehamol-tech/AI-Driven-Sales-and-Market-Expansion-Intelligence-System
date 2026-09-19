import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";
import {
  getOpportunities,
  clearOpportunitiesCache,
  willRequireGeneration,
  runOpportunityNarrativePipeline,
  type OpportunitiesPrismaDeps,
} from "../../src/modules/opportunities/opportunities.service.js";
import type { OpportunityCandidate } from "../../src/modules/opportunities/detectors.js";

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

function validNarrativeJson(ids: string[]): string {
  return JSON.stringify(ids.map((id) => ({ id, narrative: "A real narrative from the given evidence.", recommendedAction: "Take action." })));
}

function makeCandidate(overrides: Partial<OpportunityCandidate> = {}): OpportunityCandidate {
  return {
    id: "REORDER-acc_1",
    type: "REORDER",
    leadId: "acc_1",
    leadType: "accounts",
    name: "Acme Retail",
    priority: "HIGH",
    score: 88,
    classification: "HOT",
    productId: null,
    productName: null,
    evidence: [{ label: "Days overdue", value: "30 days" }],
    rankSignal: 30,
    ruleBasedNarrative: "Acme Retail is 30 days overdue for its usual ~60-day reorder cycle.",
    ruleBasedRecommendedAction: "Contact today to place a reorder.",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * runOpportunityNarrativePipeline — tests #10, #11, #13(pipeline level)
 * ---------------------------------------------------------------------- */

describe("runOpportunityNarrativePipeline", () => {
  it("returns an AI-narrated batch on success", async () => {
    const candidates = [makeCandidate()];
    const provider = makeFakeAIProvider([validNarrativeJson(["REORDER-acc_1"])]);
    const result = await runOpportunityNarrativePipeline(provider, candidates);
    expect(result.method).toBe("AI");
    expect(result.entries.get("REORDER-acc_1")?.narrative).toBe("A real narrative from the given evidence.");
  });

  it("retries once on malformed JSON, then succeeds if the retry is valid", async () => {
    const candidates = [makeCandidate()];
    const provider = makeFakeAIProvider(["not json at all", validNarrativeJson(["REORDER-acc_1"])]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runOpportunityNarrativePipeline(provider, candidates);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("AI");
  });

  it("falls back to RULE_BASED for the whole batch when the AI keeps returning malformed JSON after one retry (test #10)", async () => {
    const candidates = [makeCandidate({ id: "REORDER-acc_1" }), makeCandidate({ id: "REORDER-acc_2", leadId: "acc_2" })];
    const provider = makeFakeAIProvider(["not json", "still { not valid"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runOpportunityNarrativePipeline(provider, candidates);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
    expect(result.entries.size).toBe(0); // caller falls back to each candidate's own ruleBasedNarrative/ruleBasedRecommendedAction
  });

  it("falls back to RULE_BASED when the AI throws on both attempts (test #11)", async () => {
    const candidates = [makeCandidate()];
    const provider = makeFakeAIProvider([new Error("network error"), new Error("network error")]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runOpportunityNarrativePipeline(provider, candidates);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
  });

  it("falls back to RULE_BASED on a bijection mismatch — AI invents an id (test #13)", async () => {
    const candidates = [makeCandidate({ id: "REORDER-acc_1" })];
    const invented = validNarrativeJson(["REORDER-acc_999"]);
    const provider = makeFakeAIProvider([invented, invented]);
    const result = await runOpportunityNarrativePipeline(provider, candidates);
    expect(result.method).toBe("RULE_BASED");
  });

  it("falls back to RULE_BASED on a bijection mismatch — AI omits a requested id (test #13)", async () => {
    const candidates = [makeCandidate({ id: "REORDER-acc_1" }), makeCandidate({ id: "REORDER-acc_2", leadId: "acc_2" })];
    const partial = validNarrativeJson(["REORDER-acc_1"]); // acc_2 omitted
    const provider = makeFakeAIProvider([partial, partial]);
    const result = await runOpportunityNarrativePipeline(provider, candidates);
    expect(result.method).toBe("RULE_BASED");
  });

  it("falls back to RULE_BASED on a bijection mismatch — AI duplicates an id (test #13)", async () => {
    const candidates = [makeCandidate({ id: "REORDER-acc_1" })];
    const duplicated = JSON.stringify([
      { id: "REORDER-acc_1", narrative: "a", recommendedAction: "b" },
      { id: "REORDER-acc_1", narrative: "c", recommendedAction: "d" },
    ]);
    const provider = makeFakeAIProvider([duplicated, duplicated]);
    const result = await runOpportunityNarrativePipeline(provider, candidates);
    expect(result.method).toBe("RULE_BASED");
  });

  it("returns an empty batch without calling AI at all when there are no candidates", async () => {
    const provider = makeFakeAIProvider([validNarrativeJson([])]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runOpportunityNarrativePipeline(provider, []);
    expect(result.entries.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------
 * getOpportunities — full orchestration: detection -> ranking -> narration
 * -> caching -> filtering. Tests #9 (multi-type), #14, #15, plus caching
 * parity with Phase 3A's getSalesAgentToday.
 * ---------------------------------------------------------------------- */

describe("getOpportunities", () => {
  beforeEach(() => {
    clearOpportunitiesCache();
  });

  const NOW = new Date("2026-08-17T00:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

  /**
   * 3 real accounts each with exactly 2 real orders -> exactly one REORDER
   * candidate per account, with three different priority buckets (HIGH/
   * MEDIUM/LOW) so ranking and filtering are both exercisable. 3 decoy
   * accounts each with a single very-high-value order are added purely to
   * push the REORDER accounts out of the top value quartile, so this
   * scenario stays a clean, isolated REORDER-only test (decoys have only 1
   * order each, so they can't independently qualify for any detector).
   */
  function makeDeps(): OpportunitiesPrismaDeps {
    const accounts = [
      { id: "acc_1", name: "Acme Retail", industryId: null, stateId: null, industry: null },
      { id: "acc_2", name: "Beta Traders", industryId: null, stateId: null, industry: null },
      { id: "acc_3", name: "Gamma Supplies", industryId: null, stateId: null, industry: null },
      { id: "decoy_1", name: "Decoy One", industryId: null, stateId: null, industry: null },
      { id: "decoy_2", name: "Decoy Two", industryId: null, stateId: null, industry: null },
      { id: "decoy_3", name: "Decoy Three", industryId: null, stateId: null, industry: null },
    ];

    const salesRecords = [
      // acc_1: 60-day cycle, last order 90 days ago -> overdue 30 -> HIGH
      { accountId: "acc_1", date: daysAgo(150), orderValue: "10000", productId: null },
      { accountId: "acc_1", date: daysAgo(90), orderValue: "10000", productId: null },
      // acc_2: 30-day cycle, last order 35 days ago -> overdue 5 -> LOW
      { accountId: "acc_2", date: daysAgo(65), orderValue: "8000", productId: null },
      { accountId: "acc_2", date: daysAgo(35), orderValue: "8000", productId: null },
      // acc_3: 30-day cycle, last order 40 days ago -> overdue 10 -> MEDIUM
      { accountId: "acc_3", date: daysAgo(70), orderValue: "9000", productId: null },
      { accountId: "acc_3", date: daysAgo(40), orderValue: "9000", productId: null },
      // decoys: single very-high-value order each -> dominate the value quartile, no detector can fire on 1 order
      { accountId: "decoy_1", date: daysAgo(5), orderValue: "5000000", productId: null },
      { accountId: "decoy_2", date: daysAgo(5), orderValue: "6000000", productId: null },
      { accountId: "decoy_3", date: daysAgo(5), orderValue: "7000000", productId: null },
    ];

    return {
      account: { findMany: async () => accounts },
      salesRecord: { findMany: async () => salesRecords },
      leadScore: { findMany: async () => [] },
      product: { findMany: async () => [] },
    };
  }

  it("detects exactly 3 real REORDER opportunities with 3 distinct priorities, ranked HIGH > MEDIUM > LOW", async () => {
    const deps = makeDeps();
    const provider = makeFakeAIProvider([validNarrativeJson(["REORDER-acc_1", "REORDER-acc_3", "REORDER-acc_2"])]);
    const result = await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, now: NOW });

    expect(result.dto.totalOpportunities).toBe(3);
    expect(result.dto.counts.REORDER).toBe(3);
    expect(result.dto.counts.AT_RISK).toBe(0);
    expect(result.dto.highPriorityCount).toBe(1);
    expect(result.dto.opportunities.map((o) => o.leadId)).toEqual(["acc_1", "acc_3", "acc_2"]); // HIGH, MEDIUM, LOW order
  });

  it("counts/totalOpportunities reflect the FULL detected set, independent of the narration `limit` (test #14)", async () => {
    const deps = makeDeps();
    const provider = makeFakeAIProvider([validNarrativeJson(["REORDER-acc_1", "REORDER-acc_3"])]);
    const result = await getOpportunities(deps, provider, { companyId: "c1", limit: 2, force: false, now: NOW });

    expect(result.dto.totalOpportunities).toBe(3); // full set, even though only 2 were narrated
    expect(result.dto.counts.REORDER).toBe(3);
    expect(result.dto.opportunities).toHaveLength(2); // capped by limit
  });

  it("applies type/priority filters to the narrated result set without affecting counts/totalOpportunities (test #15)", async () => {
    const deps = makeDeps();
    const provider = makeFakeAIProvider([validNarrativeJson(["REORDER-acc_1", "REORDER-acc_3", "REORDER-acc_2"])]);

    const priorityFiltered = await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, priority: "LOW", now: NOW });
    expect(priorityFiltered.dto.opportunities).toHaveLength(1);
    expect(priorityFiltered.dto.opportunities[0].leadId).toBe("acc_2");
    expect(priorityFiltered.dto.totalOpportunities).toBe(3); // unaffected by the filter

    const typeFiltered = await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, type: "AT_RISK", now: NOW });
    expect(typeFiltered.dto.opportunities).toHaveLength(0); // no AT_RISK candidates in this scenario
    expect(typeFiltered.dto.totalOpportunities).toBe(3);
  });

  it("caches the generated result for the rest of the day — a second same-day call does not re-detect or re-call AI", async () => {
    const deps = makeDeps();
    const accountFindManySpy = vi.fn(deps.account.findMany);
    deps.account.findMany = accountFindManySpy;
    const provider = makeFakeAIProvider([validNarrativeJson(["REORDER-acc_1", "REORDER-acc_3", "REORDER-acc_2"])]);
    const aiSpy = vi.spyOn(provider, "generateCompletion");

    const first = await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, now: NOW });
    expect(first.wasGenerated).toBe(true);
    expect(accountFindManySpy).toHaveBeenCalledTimes(1);

    const second = await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, now: new Date(NOW.getTime() + 3 * 60 * 60 * 1000) });
    expect(second.wasGenerated).toBe(false);
    expect(accountFindManySpy).toHaveBeenCalledTimes(1); // not called again
    expect(aiSpy).toHaveBeenCalledTimes(1); // no additional AI call
  });

  it("force=true bypasses the cache and regenerates", async () => {
    const deps = makeDeps();
    const accountFindManySpy = vi.fn(deps.account.findMany);
    deps.account.findMany = accountFindManySpy;
    const provider = makeFakeAIProvider([validNarrativeJson(["REORDER-acc_1", "REORDER-acc_3", "REORDER-acc_2"])]);

    await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, now: NOW });
    expect(accountFindManySpy).toHaveBeenCalledTimes(1);

    const forced = await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: true, now: NOW });
    expect(forced.wasGenerated).toBe(true);
    expect(accountFindManySpy).toHaveBeenCalledTimes(2);
  });

  it("exposes the narration method even when the requested filter narrows the response to zero opportunities", async () => {
    const deps = makeDeps();
    const provider = makeFakeAIProvider([validNarrativeJson(["REORDER-acc_1", "REORDER-acc_3", "REORDER-acc_2"])]);
    const result = await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, type: "GROWING_ACCOUNT", now: NOW });
    expect(result.dto.opportunities).toHaveLength(0);
    expect(result.method).toBe("AI");
  });

  it("falls back to RULE_BASED narration end-to-end when the AI response is malformed", async () => {
    const deps = makeDeps();
    const provider = makeFakeAIProvider(["not json", "still not valid"]);
    const result = await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, now: NOW });
    expect(result.method).toBe("RULE_BASED");
    expect(result.dto.opportunities.every((o) => o.narrativeMethod === "RULE_BASED")).toBe(true);
    expect(result.dto.opportunities.find((o) => o.leadId === "acc_1")?.narrative).toContain("Acme Retail");
  });
});

describe("willRequireGeneration", () => {
  beforeEach(() => {
    clearOpportunitiesCache();
  });

  it("is true when there is no cache entry yet", () => {
    expect(willRequireGeneration("c_fresh", false, new Date("2026-08-17T09:00:00Z"))).toBe(true);
  });

  it("is always true when force=true, even with a fresh cache entry", async () => {
    const deps: OpportunitiesPrismaDeps = {
      account: { findMany: async () => [] },
      salesRecord: { findMany: async () => [] },
      leadScore: { findMany: async () => [] },
      product: { findMany: async () => [] },
    };
    const provider = makeFakeAIProvider([validNarrativeJson([])]);
    const now = new Date("2026-08-17T09:00:00Z");
    await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, now });
    expect(willRequireGeneration("c1", true, now)).toBe(true);
  });

  it("is false once a fresh same-day cache entry exists", async () => {
    const deps: OpportunitiesPrismaDeps = {
      account: { findMany: async () => [] },
      salesRecord: { findMany: async () => [] },
      leadScore: { findMany: async () => [] },
      product: { findMany: async () => [] },
    };
    const provider = makeFakeAIProvider([validNarrativeJson([])]);
    const now = new Date("2026-08-17T09:00:00Z");
    await getOpportunities(deps, provider, { companyId: "c1", limit: 15, force: false, now });
    expect(willRequireGeneration("c1", false, now)).toBe(false);
  });
});
