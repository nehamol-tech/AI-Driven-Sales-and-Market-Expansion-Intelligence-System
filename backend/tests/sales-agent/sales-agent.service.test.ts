import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";
import {
  gatherCandidates,
  runNarrativePipeline,
  getSalesAgentToday,
  clearSalesAgentCache,
  willRequireGeneration,
  type SalesAgentPrismaDeps,
} from "../../src/modules/sales-agent/sales-agent.service.js";
import type { PriorityCandidate } from "../../src/modules/sales-agent/priority.service.js";

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

function validNarrativeJson(entries: { leadId: string; productSuggestion?: string | null }[]): string {
  return JSON.stringify(
    entries.map((e) => ({
      leadId: e.leadId,
      reasons: ["A real reason phrased from the given facts."],
      recommendedAction: "Contact today",
      productSuggestion: e.productSuggestion ?? null,
    })),
  );
}

function makeCandidate(overrides: Partial<PriorityCandidate> = {}): PriorityCandidate {
  return {
    leadId: "lead_1",
    leadType: "accounts",
    name: "Acme Retail",
    score: 91,
    classification: "HOT",
    priorityScore: 130,
    priority: "HIGH",
    deterministicReasons: ["HOT classification (score 91)"],
    candidateProductNames: ["Widget A"],
    deterministicProductSuggestion: "Widget A",
    dataConfidence: "HIGH",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * gatherCandidates — real DB-shaped fake deps. Proves COLD/unscored leads
 * are excluded by construction (test #10) and that reorder-timing / product
 * matching flow through end to end.
 * ---------------------------------------------------------------------- */

describe("gatherCandidates", () => {
  function makeDeps(overrides: Partial<SalesAgentPrismaDeps> = {}): SalesAgentPrismaDeps {
    return {
      leadScore: { findMany: async () => [] },
      salesRecord: { findMany: async () => [] },
      product: { findMany: async () => [] },
      ...overrides,
    };
  }

  it("queries only isLatest HOT/WARM scores — COLD and unscored leads are excluded by the query itself", async () => {
    let capturedArgs: any;
    const deps = makeDeps({
      leadScore: {
        findMany: async (args: any) => {
          capturedArgs = args;
          return [];
        },
      },
    });
    await gatherCandidates(deps, "c1");
    expect(capturedArgs.where.companyId).toBe("c1");
    expect(capturedArgs.where.isLatest).toBe(true);
    expect(new Set(capturedArgs.where.classification.in)).toEqual(new Set(["HOT", "WARM"]));
    expect(capturedArgs.where.classification.in).not.toContain("COLD");
  });

  it("returns no candidates and totalCandidates 0 when there are no HOT/WARM leads", async () => {
    const deps = makeDeps();
    const result = await gatherCandidates(deps, "c1");
    expect(result.candidates).toEqual([]);
    expect(result.totalCandidates).toBe(0);
  });

  it("assembles an Account candidate with a real overdue-reorder signal from real SalesRecord history", async () => {
    const deps = makeDeps({
      leadScore: {
        findMany: async () => [
          {
            accountId: "acc_1",
            prospectId: null,
            score: 88,
            classification: "HOT",
            inputFeatures: { recencyDays: 5, orderCount: 3, totalOrderValue: 90000, averageOrderValue: 30000, productFitScore: 0.5, stateAlignment: "operating" },
            account: { id: "acc_1", name: "Acme Retail", industryId: "ind_1", businessTypeId: null, stateId: "state_1", industry: { name: "Retail" }, state: { name: "Karnataka" }, city: null },
          },
        ],
      },
      salesRecord: {
        findMany: async () => [
          { accountId: "acc_1", date: new Date("2026-06-01"), orderValue: "30000" },
          { accountId: "acc_1", date: new Date("2026-07-06"), orderValue: "60000" },
        ],
      },
      product: {
        findMany: async () => [{ name: "Widget A", targetIndustries: [{ industryId: "ind_1" }], targetBusinessTypes: [] }],
      },
    });

    const result = await gatherCandidates(deps, "c1");
    expect(result.totalCandidates).toBe(1);
    const candidate = result.candidates[0];
    expect(candidate.leadId).toBe("acc_1");
    expect(candidate.leadType).toBe("accounts");
    expect(candidate.score).toBe(88); // copied verbatim
    expect(candidate.classification).toBe("HOT"); // copied verbatim
    expect(candidate.dataConfidence).toBe("HIGH"); // 2 real orders -> reorder signal present
    expect(candidate.candidateProductNames).toEqual(["Widget A"]);
  });

  it("assembles a Prospect candidate with no reorder signal at all (Prospects have no SalesRecord history)", async () => {
    const deps = makeDeps({
      leadScore: {
        findMany: async () => [
          {
            accountId: null,
            prospectId: "pro_1",
            score: 55,
            classification: "WARM",
            inputFeatures: { recencyDays: null, orderCount: 0, totalOrderValue: 0, averageOrderValue: null, productFitScore: 0.3, stateAlignment: "target" },
            prospect: { id: "pro_1", businessName: "Beta Co", industryId: "ind_2", businessTypeId: "bt_1", stateId: "state_2", industry: { name: "Manufacturing" }, businessType: { name: "SME" }, state: { name: "Maharashtra" }, city: null },
          },
        ],
      },
      product: { findMany: async () => [] },
    });

    const result = await gatherCandidates(deps, "c1");
    const candidate = result.candidates[0];
    expect(candidate.leadType).toBe("prospects");
    expect(candidate.score).toBe(55);
    expect(candidate.classification).toBe("WARM");
    expect(candidate.deterministicReasons.some((r) => /overdue/i.test(r) || /cycle/i.test(r))).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * runNarrativePipeline — AI call, validation, retry, fallback.
 * Tests #5, #6, #7.
 * ---------------------------------------------------------------------- */

describe("runNarrativePipeline", () => {
  it("returns an AI-narrated batch, preserving score/classification verbatim (test #2)", async () => {
    const candidates = [makeCandidate({ leadId: "lead_1" }), makeCandidate({ leadId: "lead_2", score: 55, classification: "WARM", priority: "LOW" })];
    const provider = makeFakeAIProvider([validNarrativeJson([{ leadId: "lead_1", productSuggestion: "Widget A" }, { leadId: "lead_2" }])]);
    const result = await runNarrativePipeline(provider, candidates);
    expect(result.method).toBe("AI");
    const byId = new Map(result.priorities.map((p) => [p.leadId, p]));
    expect(byId.get("lead_1")?.score).toBe(91);
    expect(byId.get("lead_1")?.classification).toBe("HOT");
    expect(byId.get("lead_2")?.score).toBe(55);
    expect(byId.get("lead_2")?.classification).toBe("WARM");
    expect(byId.get("lead_1")?.narrativeMethod).toBe("AI");
  });

  it("retries once on malformed JSON, then succeeds if the retry is valid", async () => {
    const candidates = [makeCandidate()];
    const provider = makeFakeAIProvider(["not json at all", validNarrativeJson([{ leadId: "lead_1" }])]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runNarrativePipeline(provider, candidates);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("AI");
  });

  it("falls back to RULE_BASED for the whole batch after one retry when the AI keeps returning malformed JSON (test #5)", async () => {
    const candidates = [makeCandidate({ leadId: "lead_1" }), makeCandidate({ leadId: "lead_2" })];
    const provider = makeFakeAIProvider(["not json", "still not valid"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runNarrativePipeline(provider, candidates);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
    expect(result.priorities).toHaveLength(2);
    expect(result.priorities.every((p) => p.narrativeMethod === "RULE_BASED")).toBe(true);
    // rule-based reasons are exactly the precomputed deterministic reasons
    expect(result.priorities[0].reasons).toEqual(candidates[0].deterministicReasons);
  });

  it("falls back to RULE_BASED when the AI throws on both attempts (test #6)", async () => {
    const candidates = [makeCandidate()];
    const provider = makeFakeAIProvider([new Error("network error"), new Error("network error")]);
    const result = await runNarrativePipeline(provider, candidates);
    expect(result.method).toBe("RULE_BASED");
    expect(result.priorities[0].narrativeMethod).toBe("RULE_BASED");
  });

  it("rejects an invented productSuggestion (not in the real candidate-product list) and falls back to RULE_BASED (test #7)", async () => {
    const candidates = [makeCandidate({ leadId: "lead_1", candidateProductNames: ["Widget A"] })];
    const invented = validNarrativeJson([{ leadId: "lead_1", productSuggestion: "Totally Made Up Product" }]);
    const provider = makeFakeAIProvider([invented, invented]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runNarrativePipeline(provider, candidates);
    expect(spy).toHaveBeenCalledTimes(2); // one retry, both invalid
    expect(result.method).toBe("RULE_BASED");
    // the rule-based fallback's own deterministic pick is used instead, never the invented name
    expect(result.priorities[0].productSuggestion).toBe(candidates[0].deterministicProductSuggestion);
    expect(result.priorities[0].productSuggestion).not.toBe("Totally Made Up Product");
  });

  it("accepts a real productSuggestion that is exactly one of the lead's candidate product names", async () => {
    const candidates = [makeCandidate({ leadId: "lead_1", candidateProductNames: ["Widget A", "Widget B"] })];
    const valid = validNarrativeJson([{ leadId: "lead_1", productSuggestion: "Widget B" }]);
    const provider = makeFakeAIProvider([valid]);
    const result = await runNarrativePipeline(provider, candidates);
    expect(result.method).toBe("AI");
    expect(result.priorities[0].productSuggestion).toBe("Widget B");
  });

  it("returns an empty batch without calling AI at all when there are no candidates", async () => {
    const provider = makeFakeAIProvider([validNarrativeJson([])]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runNarrativePipeline(provider, []);
    expect(result.priorities).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------
 * getSalesAgentToday — caching + force bypass.
 * Tests #8, #9 (RBAC for #9 itself is exercised in sales-agent.routes.test.ts).
 * ---------------------------------------------------------------------- */

describe("getSalesAgentToday (cache)", () => {
  beforeEach(() => {
    clearSalesAgentCache();
  });

  function makeDeps(findManyLeadScore: any): SalesAgentPrismaDeps {
    return {
      leadScore: { findMany: findManyLeadScore },
      salesRecord: { findMany: async () => [] },
      product: { findMany: async () => [] },
    };
  }

  const oneHotScore = [
    {
      accountId: "acc_1",
      prospectId: null,
      score: 80,
      classification: "HOT",
      inputFeatures: { recencyDays: 10, orderCount: 0, totalOrderValue: 0, averageOrderValue: null, productFitScore: 0, stateAlignment: "unknown" },
      account: { id: "acc_1", name: "Acme", industryId: null, businessTypeId: null, stateId: null, industry: null, state: null, city: null },
    },
  ];

  it("does not call AI (or re-query leads) twice for two consecutive same-day requests (test #8)", async () => {
    const leadScoreFindMany = vi.fn(async () => oneHotScore);
    const deps = makeDeps(leadScoreFindMany);
    const provider = makeFakeAIProvider([validNarrativeJson([{ leadId: "acc_1" }])]);
    const aiSpy = vi.spyOn(provider, "generateCompletion");
    const now = new Date("2026-08-17T09:00:00Z");

    const first = await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false, now });
    expect(first.wasGenerated).toBe(true);
    expect(leadScoreFindMany).toHaveBeenCalledTimes(1);
    const aiCallsAfterFirst = aiSpy.mock.calls.length;
    expect(aiCallsAfterFirst).toBeGreaterThan(0);

    const second = await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false, now: new Date("2026-08-17T15:00:00Z") });
    expect(second.wasGenerated).toBe(false);
    expect(leadScoreFindMany).toHaveBeenCalledTimes(1); // not called again
    expect(aiSpy.mock.calls.length).toBe(aiCallsAfterFirst); // no additional AI call
    expect(second.dto).toEqual(first.dto);
  });

  it("force=true bypasses the cache and regenerates", async () => {
    const leadScoreFindMany = vi.fn(async () => oneHotScore);
    const deps = makeDeps(leadScoreFindMany);
    const provider = makeFakeAIProvider([validNarrativeJson([{ leadId: "acc_1" }])]);
    const now = new Date("2026-08-17T09:00:00Z");

    await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false, now });
    expect(leadScoreFindMany).toHaveBeenCalledTimes(1);

    const forced = await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: true, now });
    expect(forced.wasGenerated).toBe(true);
    expect(leadScoreFindMany).toHaveBeenCalledTimes(2);
  });

  it("regenerates on a new day even without force=true", async () => {
    const leadScoreFindMany = vi.fn(async () => oneHotScore);
    const deps = makeDeps(leadScoreFindMany);
    const provider = makeFakeAIProvider([validNarrativeJson([{ leadId: "acc_1" }])]);

    await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false, now: new Date("2026-08-17T09:00:00Z") });
    const nextDay = await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false, now: new Date("2026-08-18T09:00:00Z") });
    expect(nextDay.wasGenerated).toBe(true);
    expect(leadScoreFindMany).toHaveBeenCalledTimes(2);
  });

  it("caches independently per company", async () => {
    const leadScoreFindMany = vi.fn(async () => oneHotScore);
    const deps = makeDeps(leadScoreFindMany);
    const provider = makeFakeAIProvider([validNarrativeJson([{ leadId: "acc_1" }])]);
    const now = new Date("2026-08-17T09:00:00Z");

    await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false, now });
    const other = await getSalesAgentToday(deps, provider, { companyId: "c2", limit: 10, force: false, now });
    expect(other.wasGenerated).toBe(true);
    expect(leadScoreFindMany).toHaveBeenCalledTimes(2);
  });

  it("respects the totalCandidates vs narrated-count distinction when limit caps the batch", async () => {
    const twoHotScores = [
      oneHotScore[0],
      { ...oneHotScore[0], accountId: "acc_2", account: { ...oneHotScore[0].account, id: "acc_2", name: "Beta" } },
    ];
    const deps = makeDeps(vi.fn(async () => twoHotScores));
    const provider = makeFakeAIProvider([validNarrativeJson([{ leadId: "acc_1" }])]); // limit=1 -> only acc_1 gets narrated
    const result = await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 1, force: false, now: new Date("2026-08-17T09:00:00Z") });
    expect(result.dto.totalCandidates).toBe(2);
    expect(result.dto.priorities).toHaveLength(1);
  });
});

describe("willRequireGeneration", () => {
  beforeEach(() => {
    clearSalesAgentCache();
  });

  it("is true when there is no cache entry yet", () => {
    expect(willRequireGeneration("c_fresh", false, new Date("2026-08-17T09:00:00Z"))).toBe(true);
  });

  it("is always true when force=true, even with a fresh cache entry", async () => {
    const deps: SalesAgentPrismaDeps = {
      leadScore: { findMany: async () => [] },
      salesRecord: { findMany: async () => [] },
      product: { findMany: async () => [] },
    };
    const provider = makeFakeAIProvider([validNarrativeJson([])]);
    const now = new Date("2026-08-17T09:00:00Z");
    await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false, now });
    expect(willRequireGeneration("c1", true, now)).toBe(true);
  });

  it("is false once a fresh same-day cache entry exists (cache hit -> no generation needed)", async () => {
    const deps: SalesAgentPrismaDeps = {
      leadScore: { findMany: async () => [] },
      salesRecord: { findMany: async () => [] },
      product: { findMany: async () => [] },
    };
    const provider = makeFakeAIProvider([validNarrativeJson([])]);
    const now = new Date("2026-08-17T09:00:00Z");
    await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false, now });
    expect(willRequireGeneration("c1", false, now)).toBe(false);
  });
});
