import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";
import {
  getMarketExpansionSummary,
  getMarketDetail,
  runMarketNarrativePipeline,
  clearMarketExpansionCache,
  type MarketExpansionPrismaDeps,
} from "../../src/modules/market-expansion/market-expansion.service.js";
import type { MarketNarrationCandidate } from "../../src/modules/market-expansion/market-expansion.prompt.js";

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

function validNarrativeJson(stateIds: string[], hypothesesByState: Record<string, { productId: string; statement: string }[]> = {}): string {
  return JSON.stringify(
    stateIds.map((stateId) => ({
      stateId,
      narrative: `A real narrative for ${stateId} from the given evidence.`,
      hypothesisStatements: hypothesesByState[stateId] ?? [],
    })),
  );
}

function makeCandidate(overrides: Partial<MarketNarrationCandidate> = {}): MarketNarrationCandidate {
  return {
    stateId: "st_1",
    stateName: "Kerala",
    evidence: [{ label: "Accounts", value: "3" }],
    hypotheses: [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * runMarketNarrativePipeline — tests #9, #10, #11, #12, #13 (pipeline level)
 * ---------------------------------------------------------------------- */

describe("runMarketNarrativePipeline", () => {
  it("returns an AI-narrated batch on success", async () => {
    const candidates = [makeCandidate()];
    const provider = makeFakeAIProvider([validNarrativeJson(["st_1"])]);
    const result = await runMarketNarrativePipeline(provider, candidates, new Set());
    expect(result.method).toBe("AI");
    expect(result.entries.get("st_1")?.narrative).toContain("st_1");
  });

  it("retries once on malformed JSON, then succeeds if the retry is valid", async () => {
    const candidates = [makeCandidate()];
    const provider = makeFakeAIProvider(["not json at all", validNarrativeJson(["st_1"])]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runMarketNarrativePipeline(provider, candidates, new Set());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("AI");
  });

  it("falls back to RULE_BASED for the whole batch when the AI keeps returning malformed JSON after one retry (test #9)", async () => {
    const candidates = [makeCandidate({ stateId: "st_1" }), makeCandidate({ stateId: "st_2" })];
    const provider = makeFakeAIProvider(["not json", "still { not valid"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runMarketNarrativePipeline(provider, candidates, new Set());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
    expect(result.entries.size).toBe(0);
  });

  it("falls back to RULE_BASED when the AI throws on both attempts (test #10)", async () => {
    const candidates = [makeCandidate()];
    const provider = makeFakeAIProvider([new Error("network error"), new Error("network error")]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runMarketNarrativePipeline(provider, candidates, new Set());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
  });

  it("falls back to RULE_BASED when the AI invents a stateId (test #11)", async () => {
    const candidates = [makeCandidate({ stateId: "st_1" })];
    const invented = validNarrativeJson(["st_INVENTED"]);
    const provider = makeFakeAIProvider([invented, invented]);
    const result = await runMarketNarrativePipeline(provider, candidates, new Set());
    expect(result.method).toBe("RULE_BASED");
  });

  it("falls back to RULE_BASED when the AI invents a product/state hypothesis pairing not in the real allowlist (test #12)", async () => {
    const candidates = [makeCandidate({ stateId: "st_1", hypotheses: [{ productId: "prod_a", productName: "Product A", sourceStateName: "Karnataka", targetIndustryName: "Manufacturing" }] })];
    const allowlist = new Set(["st_1:prod_a"]);
    const invented = validNarrativeJson(["st_1"], { st_1: [{ productId: "prod_INVENTED", statement: "x" }] });
    const provider = makeFakeAIProvider([invented, invented]);
    const result = await runMarketNarrativePipeline(provider, candidates, allowlist);
    expect(result.method).toBe("RULE_BASED");
  });

  it("returns an empty batch without calling AI at all when there are no candidates (test #13, pipeline level)", async () => {
    const provider = makeFakeAIProvider([validNarrativeJson([])]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runMarketNarrativePipeline(provider, [], new Set());
    expect(result.entries.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------
 * getMarketExpansionSummary / getMarketDetail — full orchestration.
 * ---------------------------------------------------------------------- */

describe("getMarketExpansionSummary / getMarketDetail", () => {
  beforeEach(() => {
    clearMarketExpansionCache();
  });

  const NOW = new Date("2026-08-17T00:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

  function makeDeps(overrides: Partial<MarketExpansionPrismaDeps> = {}): MarketExpansionPrismaDeps {
    return {
      state: { findMany: async () => [{ id: "st_1", name: "Kerala" }] },
      salesRecord: { findMany: async () => [] },
      account: { findMany: async () => [] },
      prospect: { findMany: async () => [] },
      leadScore: { findMany: async () => [] },
      product: { findMany: async () => [] },
      ...overrides,
    };
  }

  /** One strong state (Kerala, real evidence) + one truly empty state (Goa, zero evidence). */
  function makeMixedDeps(): MarketExpansionPrismaDeps {
    return makeDeps({
      state: {
        findMany: async () => [
          { id: "st_kerala", name: "Kerala" },
          { id: "st_goa", name: "Goa" },
        ],
      },
      account: {
        findMany: async () => [
          { id: "acc_1", stateId: "st_kerala", industryId: "ind_mfg" },
          { id: "acc_2", stateId: "st_kerala", industryId: "ind_mfg" },
        ],
      },
      leadScore: {
        findMany: async () => [
          { accountId: "acc_1", classification: "HOT" },
          { accountId: "acc_2", classification: "HOT" },
        ],
      },
      salesRecord: {
        findMany: async () => [
          {
            stateId: "st_kerala",
            cityId: "city_1",
            industryId: "ind_mfg",
            productId: "prod_a",
            date: daysAgo(10),
            orderValue: "500000",
            city: { name: "Kochi" },
            industry: { name: "Manufacturing" },
            product: { name: "Product A" },
          },
        ],
      },
      product: {
        findMany: async () => [{ id: "prod_a", name: "Product A", isActive: true, targetIndustries: [{ industryId: "ind_mfg" }] }],
      },
    });
  }

  it("excludes INSUFFICIENT_DATA states from the ranked/narrated markets list but still counts them in totalStatesAnalyzed", async () => {
    const deps = makeMixedDeps();
    const provider = makeFakeAIProvider([validNarrativeJson(["st_kerala"])]);
    const result = await getMarketExpansionSummary(deps, provider, { companyId: "c1", limit: 10, force: false, now: NOW });

    expect(result.dto.totalStatesAnalyzed).toBe(2);
    expect(result.dto.totalStatesWithData).toBe(1);
    expect(result.dto.markets).toHaveLength(1);
    expect(result.dto.markets[0].stateId).toBe("st_kerala");
    expect(result.dto.markets.some((m) => m.stateId === "st_goa")).toBe(false);
  });

  it("test #13 — zero states with real evidence makes zero AI provider calls", async () => {
    const deps = makeDeps({ state: { findMany: async () => [{ id: "st_goa", name: "Goa" }] } }); // no accounts/prospects/orders anywhere
    const provider = makeFakeAIProvider(["should never be used"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await getMarketExpansionSummary(deps, provider, { companyId: "c1", limit: 10, force: false, now: NOW });
    expect(spy).not.toHaveBeenCalled();
    expect(result.dto.markets).toHaveLength(0);
    expect(result.method).toBe("RULE_BASED");
  });

  it("caches the generated result for the rest of the day — a second same-day call does not re-detect or re-call AI", async () => {
    const deps = makeMixedDeps();
    const stateFindManySpy = vi.fn(deps.state.findMany);
    deps.state.findMany = stateFindManySpy;
    const provider = makeFakeAIProvider([validNarrativeJson(["st_kerala"])]);
    const aiSpy = vi.spyOn(provider, "generateCompletion");

    const first = await getMarketExpansionSummary(deps, provider, { companyId: "c1", limit: 10, force: false, now: NOW });
    expect(first.wasGenerated).toBe(true);
    expect(stateFindManySpy).toHaveBeenCalledTimes(1);

    const second = await getMarketExpansionSummary(deps, provider, { companyId: "c1", limit: 10, force: false, now: new Date(NOW.getTime() + 3 * 60 * 60 * 1000) });
    expect(second.wasGenerated).toBe(false);
    expect(stateFindManySpy).toHaveBeenCalledTimes(1);
    expect(aiSpy).toHaveBeenCalledTimes(1);
    expect(second.dto.generatedAt).toBe(first.dto.generatedAt); // baked in at generation time, reused verbatim
  });

  it("force=true bypasses the cache and regenerates", async () => {
    const deps = makeMixedDeps();
    const stateFindManySpy = vi.fn(deps.state.findMany);
    deps.state.findMany = stateFindManySpy;
    const provider = makeFakeAIProvider([validNarrativeJson(["st_kerala"])]);

    await getMarketExpansionSummary(deps, provider, { companyId: "c1", limit: 10, force: false, now: NOW });
    expect(stateFindManySpy).toHaveBeenCalledTimes(1);

    const forced = await getMarketExpansionSummary(deps, provider, { companyId: "c1", limit: 10, force: true, now: NOW });
    expect(forced.wasGenerated).toBe(true);
    expect(stateFindManySpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to RULE_BASED narration end-to-end when the AI response is malformed, using each state's real evidence in the fallback text", async () => {
    const deps = makeMixedDeps();
    const provider = makeFakeAIProvider(["not json", "still not valid"]);
    const result = await getMarketExpansionSummary(deps, provider, { companyId: "c1", limit: 10, force: false, now: NOW });
    expect(result.method).toBe("RULE_BASED");
    expect(result.dto.markets[0].narrativeMethod).toBe("RULE_BASED");
    expect(result.dto.markets[0].narrative).toContain("Kerala");
  });

  describe("getMarketDetail", () => {
    it("returns the full detail DTO (breakdowns, growth signal, hypotheses) for a real state with evidence, reusing the cached narrative", async () => {
      const deps = makeMixedDeps();
      const provider = makeFakeAIProvider([validNarrativeJson(["st_kerala"])]);

      await getMarketExpansionSummary(deps, provider, { companyId: "c1", limit: 10, force: false, now: NOW });
      const aiSpy = vi.spyOn(provider, "generateCompletion");

      const detailResult = await getMarketDetail(deps, provider, { companyId: "c1", stateId: "st_kerala", force: false, now: NOW });
      expect(detailResult.wasGenerated).toBe(false); // reused today's cache, no new generation
      expect(aiSpy).not.toHaveBeenCalled();
      expect(detailResult.dto).not.toBeNull();
      expect(detailResult.dto?.narrative).toContain("st_kerala"); // the cached AI narrative, not a re-narrated one
      expect(detailResult.dto?.cityBreakdown[0]).toMatchObject({ cityId: "city_1", cityName: "Kochi" });
      expect(detailResult.dto?.industrySignals[0]).toMatchObject({ industryId: "ind_mfg", industryName: "Manufacturing" });
      expect(detailResult.dto?.productSignals[0]).toMatchObject({ productId: "prod_a", productName: "Product A" });
    });

    it("returns the full INSUFFICIENT_DATA DTO shape (never null) for a real state with zero evidence", async () => {
      const deps = makeMixedDeps();
      const provider = makeFakeAIProvider([validNarrativeJson(["st_kerala"])]);

      const result = await getMarketDetail(deps, provider, { companyId: "c1", stateId: "st_goa", force: false, now: NOW });
      expect(result.dto).not.toBeNull();
      expect(result.dto?.classification).toBe("INSUFFICIENT_DATA");
      expect(result.dto?.score).toBeNull();
      expect(result.dto?.accountCount).toBe(0);
      expect(result.dto?.narrative).not.toBeNull();
      expect(result.dto?.expansionHypotheses).toEqual([]);
    });

    it("returns null (the controller's 404 signal) for a stateId that doesn't correspond to any real seeded state", async () => {
      const deps = makeMixedDeps();
      const provider = makeFakeAIProvider([validNarrativeJson(["st_kerala"])]);
      const result = await getMarketDetail(deps, provider, { companyId: "c1", stateId: "st_DOES_NOT_EXIST", force: false, now: NOW });
      expect(result.dto).toBeNull();
    });
  });
});
