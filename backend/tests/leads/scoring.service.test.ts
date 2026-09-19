import { describe, it, expect, vi } from "vitest";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";
import {
  computeInputFeatures,
  classifyScore,
  computeRuleBasedScore,
  buildRuleBasedReasons,
  getMissingProspectFields,
  runScoringPipeline,
  scoreAccount,
  scoreProspect,
  persistLeadScore,
  type ScoringPrismaDeps,
  type LeadInputFeatures,
} from "../../src/modules/leads/scoring.service.js";
import type { LeadScoringPromptInput } from "../../src/lib/ai/prompts/lead-scoring.prompt.js";

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

function validAIResponseJson(score: number): string {
  return JSON.stringify({
    score,
    reasons: [
      { factor: "Order recency", signal: "positive", detail: "Recent order activity." },
      { factor: "Order volume", signal: "positive", detail: "Healthy order volume." },
      { factor: "Product fit", signal: "neutral", detail: "Partial product fit." },
    ],
    recommendedAction: { action: "Follow up", rationale: "Good signals overall." },
  });
}

const basePromptInput: LeadScoringPromptInput = {
  leadKind: "existing customer",
  businessName: "Acme Corp",
  industryName: "Retail",
  businessTypeName: null,
  stateName: "Karnataka",
  cityName: "Bengaluru",
  inputFeatures: {
    recencyDays: 10,
    orderCount: 3,
    totalOrderValue: 15000,
    averageOrderValue: 5000,
    productFitScore: 0.5,
    stateAlignment: "operating",
  },
};

/* -------------------------------------------------------------------------
 * computeInputFeatures
 * ---------------------------------------------------------------------- */

describe("computeInputFeatures", () => {
  const now = new Date("2026-08-14T00:00:00Z");

  it("returns null recencyDays and zero counts when there are no orders", () => {
    const features = computeInputFeatures({
      now,
      industryId: null,
      businessTypeId: null,
      stateId: null,
      orders: [],
      companyProducts: [],
      operatingStateIds: [],
      targetStateIds: [],
    });
    expect(features.recencyDays).toBeNull();
    expect(features.orderCount).toBe(0);
    expect(features.totalOrderValue).toBe(0);
    expect(features.averageOrderValue).toBeNull();
  });

  it("computes recencyDays from the most recent order among several", () => {
    const features = computeInputFeatures({
      now,
      industryId: null,
      businessTypeId: null,
      stateId: null,
      orders: [
        { date: new Date("2026-07-01T00:00:00Z"), orderValue: 1000 }, // 44 days ago
        { date: new Date("2026-08-04T00:00:00Z"), orderValue: 2000 }, // 10 days ago (most recent)
        { date: new Date("2026-06-01T00:00:00Z"), orderValue: 500 },
      ],
      companyProducts: [],
      operatingStateIds: [],
      targetStateIds: [],
    });
    expect(features.recencyDays).toBe(10);
    expect(features.orderCount).toBe(3);
    expect(features.totalOrderValue).toBe(3500);
    expect(features.averageOrderValue).toBeCloseTo(1166.67, 1);
  });

  it("computes productFitScore as the fraction of products matching industry or business type", () => {
    const features = computeInputFeatures({
      now,
      industryId: "ind_1",
      businessTypeId: null,
      stateId: null,
      orders: [],
      companyProducts: [
        { targetIndustryIds: ["ind_1"], targetBusinessTypeIds: [] },
        { targetIndustryIds: ["ind_2"], targetBusinessTypeIds: [] },
        { targetIndustryIds: [], targetBusinessTypeIds: [] },
        { targetIndustryIds: ["ind_1", "ind_3"], targetBusinessTypeIds: [] },
      ],
      operatingStateIds: [],
      targetStateIds: [],
    });
    expect(features.productFitScore).toBe(0.5); // 2 of 4 match
  });

  it("returns productFitScore 0 when there are no company products at all", () => {
    const features = computeInputFeatures({
      now,
      industryId: "ind_1",
      businessTypeId: null,
      stateId: null,
      orders: [],
      companyProducts: [],
      operatingStateIds: [],
      targetStateIds: [],
    });
    expect(features.productFitScore).toBe(0);
  });

  it("classifies stateAlignment as operating, target, none, or unknown", () => {
    const args = {
      now,
      industryId: null,
      businessTypeId: null,
      orders: [],
      companyProducts: [],
      operatingStateIds: ["state_op"],
      targetStateIds: ["state_target"],
    };
    expect(computeInputFeatures({ ...args, stateId: "state_op" }).stateAlignment).toBe("operating");
    expect(computeInputFeatures({ ...args, stateId: "state_target" }).stateAlignment).toBe("target");
    expect(computeInputFeatures({ ...args, stateId: "state_other" }).stateAlignment).toBe("none");
    expect(computeInputFeatures({ ...args, stateId: null }).stateAlignment).toBe("unknown");
  });
});

/* -------------------------------------------------------------------------
 * classifyScore — deterministic classification thresholds
 * ---------------------------------------------------------------------- */

describe("classifyScore", () => {
  it("classifies 70 as HOT (lower boundary of HOT)", () => {
    expect(classifyScore(70)).toBe("HOT");
  });
  it("classifies 69 as WARM (just below HOT)", () => {
    expect(classifyScore(69)).toBe("WARM");
  });
  it("classifies 40 as WARM (lower boundary of WARM)", () => {
    expect(classifyScore(40)).toBe("WARM");
  });
  it("classifies 39 as COLD (just below WARM)", () => {
    expect(classifyScore(39)).toBe("COLD");
  });
  it("classifies 100 as HOT and 0 as COLD", () => {
    expect(classifyScore(100)).toBe("HOT");
    expect(classifyScore(0)).toBe("COLD");
  });
});

/* -------------------------------------------------------------------------
 * Rule-based fallback formula
 * ---------------------------------------------------------------------- */

describe("computeRuleBasedScore", () => {
  const baseFeatures: LeadInputFeatures = {
    recencyDays: 100,
    orderCount: 2,
    totalOrderValue: 10000,
    averageOrderValue: 5000,
    productFitScore: 0.5,
    stateAlignment: "none",
  };

  it("always returns a score within [0, 100]", () => {
    const score = computeRuleBasedScore(baseFeatures);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("scores a more recent order higher than a stale one, all else equal", () => {
    const fresh = computeRuleBasedScore({ ...baseFeatures, recencyDays: 5 });
    const stale = computeRuleBasedScore({ ...baseFeatures, recencyDays: 170 });
    expect(fresh).toBeGreaterThan(stale);
  });

  it("scores more orders and higher order value higher, all else equal", () => {
    const low = computeRuleBasedScore({ ...baseFeatures, orderCount: 1, totalOrderValue: 1000 });
    const high = computeRuleBasedScore({ ...baseFeatures, orderCount: 10, totalOrderValue: 500000 });
    expect(high).toBeGreaterThan(low);
  });

  it("scores full product fit higher than zero product fit, all else equal", () => {
    const noFit = computeRuleBasedScore({ ...baseFeatures, productFitScore: 0 });
    const fullFit = computeRuleBasedScore({ ...baseFeatures, productFitScore: 1 });
    expect(fullFit).toBeGreaterThan(noFit);
  });

  it("scores operating-state alignment higher than no alignment, all else equal", () => {
    const none = computeRuleBasedScore({ ...baseFeatures, stateAlignment: "none" });
    const operating = computeRuleBasedScore({ ...baseFeatures, stateAlignment: "operating" });
    expect(operating).toBeGreaterThan(none);
  });

  it("produces generic, non-AI-narrative reasons labeled as rule-based estimates", () => {
    const reasons = buildRuleBasedReasons(baseFeatures);
    expect(reasons.length).toBeGreaterThanOrEqual(3);
    for (const reason of reasons) {
      expect(reason.detail).toMatch(/Rule-based estimate/);
    }
  });
});

/* -------------------------------------------------------------------------
 * Insufficient-data gate for prospects
 * ---------------------------------------------------------------------- */

describe("getMissingProspectFields", () => {
  it("flags missing industryId", () => {
    const missing = getMissingProspectFields({ industryId: null, stateId: "s1", cityId: null });
    expect(missing).toContain("industryId");
  });

  it("flags missing state/city when both are absent", () => {
    const missing = getMissingProspectFields({ industryId: "ind_1", stateId: null, cityId: null });
    expect(missing).toContain("stateId or cityId");
  });

  it("returns no missing fields when industryId + stateId are present", () => {
    expect(getMissingProspectFields({ industryId: "ind_1", stateId: "s1", cityId: null })).toEqual([]);
  });

  it("returns no missing fields when industryId + cityId are present (no stateId needed)", () => {
    expect(getMissingProspectFields({ industryId: "ind_1", stateId: null, cityId: "c1" })).toEqual([]);
  });

  it("flags both fields missing when nothing is set", () => {
    const missing = getMissingProspectFields({ industryId: null, stateId: null, cityId: null });
    expect(missing).toEqual(["industryId", "stateId or cityId"]);
  });
});

/* -------------------------------------------------------------------------
 * AI call + zod validation + retry + fallback pipeline
 * ---------------------------------------------------------------------- */

describe("runScoringPipeline", () => {
  it("uses the AI-provided score and tags method AI when the response is valid JSON", async () => {
    const provider = makeFakeAIProvider([validAIResponseJson(82)]);
    const result = await runScoringPipeline(provider, basePromptInput, basePromptInput.inputFeatures);
    expect(result.method).toBe("AI");
    expect(result.score).toBe(82);
    expect(result.classification).toBe("HOT"); // derived from the score, not trusted from the AI
    expect(result.provider).toBe("fake");
  });

  it("retries once on malformed JSON, then succeeds if the retry is valid", async () => {
    const provider = makeFakeAIProvider(["not json at all", validAIResponseJson(55)]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runScoringPipeline(provider, basePromptInput, basePromptInput.inputFeatures);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("AI");
    expect(result.score).toBe(55);
  });

  it("falls back to RULE_BASED after one retry when the AI keeps returning malformed JSON", async () => {
    const provider = makeFakeAIProvider(["not json", "still not valid json"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runScoringPipeline(provider, basePromptInput, basePromptInput.inputFeatures);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
    expect(result.reasons.every((r) => r.detail.includes("Rule-based estimate"))).toBe(true);
  });

  it("falls back to RULE_BASED when the AI throws on both attempts", async () => {
    const provider = makeFakeAIProvider([new Error("network error"), new Error("network error")]);
    const result = await runScoringPipeline(provider, basePromptInput, basePromptInput.inputFeatures);
    expect(result.method).toBe("RULE_BASED");
  });

  it("rejects a response missing required fields (e.g. no recommendedAction) and falls back", async () => {
    const malformed = JSON.stringify({ score: 50, reasons: [] });
    const provider = makeFakeAIProvider([malformed, malformed]);
    const result = await runScoringPipeline(provider, basePromptInput, basePromptInput.inputFeatures);
    expect(result.method).toBe("RULE_BASED");
  });

  it("rejects a score outside 0-100 and falls back", async () => {
    const outOfRange = JSON.stringify({
      score: 150,
      reasons: [
        { factor: "a", signal: "positive", detail: "d" },
        { factor: "b", signal: "positive", detail: "d" },
        { factor: "c", signal: "positive", detail: "d" },
      ],
      recommendedAction: { action: "x", rationale: "y" },
    });
    const provider = makeFakeAIProvider([outOfRange, outOfRange]);
    const result = await runScoringPipeline(provider, basePromptInput, basePromptInput.inputFeatures);
    expect(result.method).toBe("RULE_BASED");
  });
});

/* -------------------------------------------------------------------------
 * scoreAccount / scoreProspect orchestration
 * ---------------------------------------------------------------------- */

function makeFakeDeps(overrides: Partial<ScoringPrismaDeps> = {}): ScoringPrismaDeps {
  return {
    account: { findFirst: async () => null },
    prospect: { findFirst: async () => null },
    salesRecord: { findMany: async () => [] },
    product: { findMany: async () => [] },
    companyOperatingState: { findMany: async () => [] },
    companyTargetState: { findMany: async () => [] },
    leadScore: { findFirst: async () => null },
    ...overrides,
  };
}

describe("scoreAccount", () => {
  it("returns not_found when the account doesn't exist for the company", async () => {
    const deps = makeFakeDeps();
    const provider = makeFakeAIProvider([validAIResponseJson(60)]);
    const outcome = await scoreAccount(deps, provider, {
      companyId: "c1",
      leadId: "missing",
      force: false,
      isPrivilegedCaller: false,
      cooldownHours: 24,
    });
    expect(outcome.status).toBe("not_found");
  });

  it("computes a real score from sales history when the account exists (always qualifies)", async () => {
    const deps = makeFakeDeps({
      account: {
        findFirst: async () => ({ id: "a1", companyId: "c1", name: "Acme", industryId: null, stateId: null, industry: null, state: null, city: null }),
      },
      salesRecord: {
        findMany: async () => [
          { date: new Date("2026-08-01"), orderValue: "2000" },
          { date: new Date("2026-07-01"), orderValue: "1000" },
        ],
      },
    });
    const provider = makeFakeAIProvider([validAIResponseJson(75)]);
    const outcome = await scoreAccount(deps, provider, {
      companyId: "c1",
      leadId: "a1",
      force: false,
      isPrivilegedCaller: false,
      cooldownHours: 24,
      now: new Date("2026-08-14"),
    });
    expect(outcome.status).toBe("ready_to_persist");
    if (outcome.status === "ready_to_persist") {
      expect(outcome.inputFeatures.orderCount).toBe(2);
      expect(outcome.inputFeatures.totalOrderValue).toBe(3000);
      expect(outcome.pipelineResult.score).toBe(75);
      expect(outcome.pipelineResult.classification).toBe("HOT");
    }
  });

  it("short-circuits to the existing latest score within the cooldown window (no AI call)", async () => {
    const recentScore = { id: "score_1", createdAt: new Date("2026-08-14T00:00:00Z"), score: 42 };
    const deps = makeFakeDeps({
      account: { findFirst: async () => ({ id: "a1", companyId: "c1", name: "Acme", industryId: null, stateId: null }) },
      leadScore: { findFirst: async () => recentScore },
    });
    const provider = makeFakeAIProvider([validAIResponseJson(99)]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const outcome = await scoreAccount(deps, provider, {
      companyId: "c1",
      leadId: "a1",
      force: false,
      isPrivilegedCaller: false,
      cooldownHours: 24,
      now: new Date("2026-08-14T02:00:00Z"), // 2 hours later, well within a 24h cooldown
    });
    expect(outcome.status).toBe("cooldown");
    expect(spy).not.toHaveBeenCalled();
  });

  it("bypasses the cooldown when force=true and the caller is privileged (ADMIN/MANAGER)", async () => {
    const recentScore = { id: "score_1", createdAt: new Date("2026-08-14T00:00:00Z"), score: 42 };
    const deps = makeFakeDeps({
      account: { findFirst: async () => ({ id: "a1", companyId: "c1", name: "Acme", industryId: null, stateId: null }) },
      leadScore: { findFirst: async () => recentScore },
    });
    const provider = makeFakeAIProvider([validAIResponseJson(99)]);
    const outcome = await scoreAccount(deps, provider, {
      companyId: "c1",
      leadId: "a1",
      force: true,
      isPrivilegedCaller: true,
      cooldownHours: 24,
      now: new Date("2026-08-14T02:00:00Z"),
    });
    expect(outcome.status).toBe("ready_to_persist");
  });

  it("does NOT bypass the cooldown when force=true but the caller is not privileged", async () => {
    const recentScore = { id: "score_1", createdAt: new Date("2026-08-14T00:00:00Z"), score: 42 };
    const deps = makeFakeDeps({
      account: { findFirst: async () => ({ id: "a1", companyId: "c1", name: "Acme", industryId: null, stateId: null }) },
      leadScore: { findFirst: async () => recentScore },
    });
    const provider = makeFakeAIProvider([validAIResponseJson(99)]);
    const outcome = await scoreAccount(deps, provider, {
      companyId: "c1",
      leadId: "a1",
      force: true,
      isPrivilegedCaller: false,
      cooldownHours: 24,
      now: new Date("2026-08-14T02:00:00Z"),
    });
    expect(outcome.status).toBe("cooldown");
  });
});

describe("scoreProspect", () => {
  it("returns insufficient_data when the prospect has no industry or state/city", async () => {
    const deps = makeFakeDeps({
      prospect: { findFirst: async () => ({ id: "p1", companyId: "c1", businessName: "Beta", industryId: null, stateId: null, cityId: null }) },
    });
    const provider = makeFakeAIProvider([validAIResponseJson(50)]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const outcome = await scoreProspect(deps, provider, {
      companyId: "c1",
      leadId: "p1",
      force: false,
      isPrivilegedCaller: false,
      cooldownHours: 24,
    });
    expect(outcome.status).toBe("insufficient_data");
    if (outcome.status === "insufficient_data") {
      expect(outcome.missing).toContain("industryId");
      expect(outcome.missing).toContain("stateId or cityId");
    }
    expect(spy).not.toHaveBeenCalled(); // never calls AI when data is insufficient
  });

  it("scores a prospect once industry + state are set", async () => {
    const deps = makeFakeDeps({
      prospect: {
        findFirst: async () => ({
          id: "p1",
          companyId: "c1",
          businessName: "Beta",
          industryId: "ind_1",
          businessTypeId: null,
          stateId: "state_1",
          cityId: null,
          industry: { name: "Retail" },
          businessType: null,
          state: { name: "Karnataka" },
          city: null,
        }),
      },
    });
    const provider = makeFakeAIProvider([validAIResponseJson(45)]);
    const outcome = await scoreProspect(deps, provider, {
      companyId: "c1",
      leadId: "p1",
      force: false,
      isPrivilegedCaller: false,
      cooldownHours: 24,
    });
    expect(outcome.status).toBe("ready_to_persist");
    if (outcome.status === "ready_to_persist") {
      expect(outcome.pipelineResult.score).toBe(45);
      expect(outcome.pipelineResult.classification).toBe("WARM");
    }
  });
});

/* -------------------------------------------------------------------------
 * persistLeadScore — accountId/prospectId XOR invariant
 * ---------------------------------------------------------------------- */

describe("persistLeadScore XOR invariant", () => {
  const pipelineResult = {
    score: 50,
    classification: "WARM" as const,
    method: "RULE_BASED" as const,
    reasons: buildRuleBasedReasons({
      recencyDays: 10,
      orderCount: 1,
      totalOrderValue: 1000,
      averageOrderValue: 1000,
      productFitScore: 0,
      stateAlignment: "none",
    }),
    recommendedAction: { action: "Review", rationale: "test" },
    provider: "mock",
    modelName: null,
    promptVersion: "v1",
  };
  const inputFeatures: LeadInputFeatures = {
    recencyDays: 10,
    orderCount: 1,
    totalOrderValue: 1000,
    averageOrderValue: 1000,
    productFitScore: 0,
    stateAlignment: "none",
  };

  it("throws when neither accountId nor prospectId is set", async () => {
    await expect(
      persistLeadScore({} as never, { companyId: "c1", createdById: null, pipelineResult, inputFeatures }),
    ).rejects.toThrow(/XOR/);
  });

  it("throws when both accountId and prospectId are set", async () => {
    await expect(
      persistLeadScore({} as never, {
        companyId: "c1",
        accountId: "a1",
        prospectId: "p1",
        createdById: null,
        pipelineResult,
        inputFeatures,
      }),
    ).rejects.toThrow(/XOR/);
  });

  it("does not throw the XOR error when exactly accountId is set (proceeds to use prisma)", async () => {
    const fakePrisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    };
    await expect(
      persistLeadScore(fakePrisma as never, { companyId: "c1", accountId: "a1", createdById: null, pipelineResult, inputFeatures }),
    ).rejects.toThrow(); // fails later inside the fake transaction (no real tx.leadScore), but NOT with an XOR error
    expect(fakePrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
