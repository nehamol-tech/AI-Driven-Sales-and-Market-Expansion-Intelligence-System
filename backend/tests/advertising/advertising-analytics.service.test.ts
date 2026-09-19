import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";
import {
  computeCampaignAnalytics,
  runAdvertisingNarrativePipeline,
  getAdvertisingAnalytics,
  clearAdvertisingAnalyticsCache,
  type AdvertisingAnalyticsPrismaDeps,
  type CampaignRow,
} from "../../src/modules/advertising/advertising-analytics.service.js";
import type { AdvertisingAnalyticsEvidence } from "../../src/modules/advertising/advertising-analytics.prompt.js";

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

function makeCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return { id: "camp_1", name: "Test Campaign", platform: "META", source: "MANUAL", startDate: new Date("2026-01-01T00:00:00Z"), ...overrides };
}

interface DepsOverrides {
  totalSpend?: number;
  leadsGenerated?: number;
  leadsWon?: number;
  wonProspects?: { businessName: string }[];
  accountsByNormalizedName?: Record<string, { id: string }>;
  salesByAccountId?: Record<string, number>;
}

function makeDeps(overrides: DepsOverrides = {}): AdvertisingAnalyticsPrismaDeps {
  const {
    totalSpend = 0,
    leadsGenerated = 0,
    leadsWon = 0,
    wonProspects = [],
    accountsByNormalizedName = {},
    salesByAccountId = {},
  } = overrides;

  return {
    adCampaign: { findMany: vi.fn(async () => []) },
    adSpendRecord: {
      aggregate: vi.fn(async () => ({ _sum: { amount: totalSpend } })),
    },
    prospect: {
      count: vi.fn(async (args: any) => (args.where.status === "WON" ? leadsWon : leadsGenerated)),
      findMany: vi.fn(async () => wonProspects),
    },
    account: {
      findUnique: vi.fn(async (args: any) => {
        const normalizedName = args.where.companyId_normalizedName.normalizedName as string;
        return accountsByNormalizedName[normalizedName] ?? null;
      }),
    },
    salesRecord: {
      aggregate: vi.fn(async (args: any) => ({ _sum: { orderValue: salesByAccountId[args.where.accountId] ?? 0 } })),
    },
  };
}

/* -------------------------------------------------------------------------
 * computeCampaignAnalytics — every metric branch.
 * ---------------------------------------------------------------------- */

describe("computeCampaignAnalytics", () => {
  it("zero leads generated -> costPerLead insufficient_data, zero spend", async () => {
    const deps = makeDeps({ totalSpend: 0, leadsGenerated: 0, leadsWon: 0 });
    const result = await computeCampaignAnalytics(deps, "c1", makeCampaign());
    expect(result.totalSpend).toBe("0");
    expect(result.leadsGenerated).toBe(0);
    expect(result.costPerLead).toEqual({ status: "insufficient_data" });
    expect(result.attributedRevenue).toEqual({ status: "insufficient_data" });
    expect(result.roas).toEqual({ status: "insufficient_data" });
  });

  it("leads generated but none won -> costPerLead ok, attributedRevenue/roas insufficient_data", async () => {
    const deps = makeDeps({ totalSpend: 500, leadsGenerated: 10, leadsWon: 0 });
    const result = await computeCampaignAnalytics(deps, "c1", makeCampaign());
    expect(result.totalSpend).toBe("500");
    expect(result.leadsGenerated).toBe(10);
    expect(result.leadsWon).toBe(0);
    expect(result.costPerLead).toEqual({ status: "ok", value: "50" });
    expect(result.attributedRevenue).toEqual({ status: "insufficient_data" });
    expect(result.roas).toEqual({ status: "insufficient_data" });
  });

  it("won leads but none match a real Account -> attributedRevenue insufficient_data", async () => {
    const deps = makeDeps({
      totalSpend: 500,
      leadsGenerated: 10,
      leadsWon: 2,
      wonProspects: [{ businessName: "Nonexistent Co" }, { businessName: "Another Ghost Inc" }],
      accountsByNormalizedName: {}, // no matches
    });
    const result = await computeCampaignAnalytics(deps, "c1", makeCampaign());
    expect(result.leadsWon).toBe(2);
    expect(result.attributedRevenue).toEqual({ status: "insufficient_data" });
    expect(result.roas).toEqual({ status: "insufficient_data" });
  });

  it("won lead matches a real Account with real SalesRecord revenue since campaign start -> attributedRevenue and roas ok", async () => {
    const deps = makeDeps({
      totalSpend: 200,
      leadsGenerated: 5,
      leadsWon: 1,
      wonProspects: [{ businessName: "Acme Corp" }],
      accountsByNormalizedName: { "acme corp": { id: "acc_1" } },
      salesByAccountId: { acc_1: 1000 },
    });
    const result = await computeCampaignAnalytics(deps, "c1", makeCampaign());
    expect(result.attributedRevenue).toEqual({ status: "ok", value: "1000" });
    expect(result.roas).toEqual({ status: "ok", value: 5 }); // 1000/200
  });

  it("zero spend edge case: attributedRevenue known but totalSpend is 0 -> roas insufficient_data (never divide by zero)", async () => {
    const deps = makeDeps({
      totalSpend: 0,
      leadsGenerated: 3,
      leadsWon: 1,
      wonProspects: [{ businessName: "Acme Corp" }],
      accountsByNormalizedName: { "acme corp": { id: "acc_1" } },
      salesByAccountId: { acc_1: 500 },
    });
    const result = await computeCampaignAnalytics(deps, "c1", makeCampaign());
    expect(result.attributedRevenue).toEqual({ status: "ok", value: "500" });
    expect(result.roas).toEqual({ status: "insufficient_data" });
  });

  it("two WON prospects resolving to the SAME account are only counted once (no double-counted revenue)", async () => {
    const deps = makeDeps({
      totalSpend: 100,
      leadsGenerated: 2,
      leadsWon: 2,
      wonProspects: [{ businessName: "Acme Corp" }, { businessName: "  ACME CORP  " }], // same normalized name
      accountsByNormalizedName: { "acme corp": { id: "acc_1" } },
      salesByAccountId: { acc_1: 300 },
    });
    const result = await computeCampaignAnalytics(deps, "c1", makeCampaign());
    expect(result.attributedRevenue).toEqual({ status: "ok", value: "300" }); // not 600
  });

  it("reuses normalizeAccountName via account-resolution.service.ts — never reimplements it (trim+lowercase behavior verified indirectly through matching)", async () => {
    const deps = makeDeps({
      totalSpend: 100,
      leadsGenerated: 1,
      leadsWon: 1,
      wonProspects: [{ businessName: "  Mixed Case Co  " }],
      accountsByNormalizedName: { "mixed case co": { id: "acc_2" } },
      salesByAccountId: { acc_2: 250 },
    });
    const result = await computeCampaignAnalytics(deps, "c1", makeCampaign());
    expect(result.attributedRevenue).toEqual({ status: "ok", value: "250" });
  });
});

/* -------------------------------------------------------------------------
 * runAdvertisingNarrativePipeline — AI/fallback pipeline.
 * ---------------------------------------------------------------------- */

function makeEvidence(overrides: Partial<AdvertisingAnalyticsEvidence> = {}): AdvertisingAnalyticsEvidence {
  return {
    campaigns: [
      {
        campaignId: "c1",
        campaignName: "Test Campaign",
        platform: "META",
        source: "MANUAL",
        totalSpend: "100",
        leadsGenerated: 5,
        leadsWon: 1,
        costPerLead: { status: "ok", value: "20" },
        attributedRevenue: { status: "insufficient_data" },
        roas: { status: "insufficient_data" },
      },
    ],
    ...overrides,
  };
}

describe("runAdvertisingNarrativePipeline", () => {
  it("returns an AI-narrated result on success", async () => {
    const provider = makeFakeAIProvider([validNarrativeJson("Great real narrative.")]);
    const result = await runAdvertisingNarrativePipeline(provider, makeEvidence());
    expect(result.method).toBe("AI");
    expect(result.narrative).toBe("Great real narrative.");
  });

  it("retries once on malformed JSON, then succeeds if the retry is valid", async () => {
    const provider = makeFakeAIProvider(["not json at all", validNarrativeJson()]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runAdvertisingNarrativePipeline(provider, makeEvidence());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("AI");
  });

  it("falls back to RULE_BASED when the AI keeps returning malformed JSON after one retry", async () => {
    const provider = makeFakeAIProvider(["not json", "still not valid"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runAdvertisingNarrativePipeline(provider, makeEvidence());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
    expect(result.narrative).not.toBeNull();
  });

  it("falls back to RULE_BASED when the AI throws on both attempts", async () => {
    const provider = makeFakeAIProvider([new Error("network error"), new Error("network error")]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runAdvertisingNarrativePipeline(provider, makeEvidence());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
  });

  it("skips the AI call entirely and returns narrative: null when there are zero campaigns", async () => {
    const provider = makeFakeAIProvider(["should never be used"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runAdvertisingNarrativePipeline(provider, makeEvidence({ campaigns: [] }));
    expect(spy).not.toHaveBeenCalled();
    expect(result.narrative).toBeNull();
    expect(result.method).toBe("RULE_BASED");
  });
});

/* -------------------------------------------------------------------------
 * getAdvertisingAnalytics — cache/force orchestration.
 * ---------------------------------------------------------------------- */

describe("getAdvertisingAnalytics orchestration", () => {
  beforeEach(() => {
    clearAdvertisingAnalyticsCache();
  });

  const NOW = new Date("2026-08-19T00:00:00Z");

  function makeOrchestrationDeps(): AdvertisingAnalyticsPrismaDeps {
    return {
      adCampaign: {
        findMany: vi.fn(async () => [
          { id: "camp_1", name: "Campaign One", platform: "META", source: "MANUAL", startDate: new Date("2026-01-01T00:00:00Z"), isActive: true },
        ]),
      },
      adSpendRecord: { aggregate: vi.fn(async () => ({ _sum: { amount: 100 } })) },
      prospect: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
      account: { findUnique: vi.fn(async () => null) },
      salesRecord: { aggregate: vi.fn(async () => ({ _sum: { orderValue: 0 } })) },
    };
  }

  it("caches the generated result for the rest of the day — a second same-day call does not re-hit the DB or re-call AI", async () => {
    const deps = makeOrchestrationDeps();
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    const aiSpy = vi.spyOn(provider, "generateCompletion");

    const first = await getAdvertisingAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(first.wasGenerated).toBe(true);
    expect(deps.adCampaign.findMany).toHaveBeenCalledTimes(1);

    const second = await getAdvertisingAnalytics(deps, provider, { companyId: "c1", force: false, now: new Date(NOW.getTime() + 3 * 60 * 60 * 1000) });
    expect(second.wasGenerated).toBe(false);
    expect(deps.adCampaign.findMany).toHaveBeenCalledTimes(1);
    expect(aiSpy).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses the cache and regenerates", async () => {
    const deps = makeOrchestrationDeps();
    const provider = makeFakeAIProvider([validNarrativeJson()]);

    await getAdvertisingAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(deps.adCampaign.findMany).toHaveBeenCalledTimes(1);

    const forced = await getAdvertisingAnalytics(deps, provider, { companyId: "c1", force: true, now: NOW });
    expect(forced.wasGenerated).toBe(true);
    expect(deps.adCampaign.findMany).toHaveBeenCalledTimes(2);
  });

  it("zero active campaigns -> zero AI calls and narrative: null", async () => {
    const deps: AdvertisingAnalyticsPrismaDeps = {
      adCampaign: { findMany: vi.fn(async () => []) },
      adSpendRecord: { aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) },
      prospect: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
      account: { findUnique: vi.fn(async () => null) },
      salesRecord: { aggregate: vi.fn(async () => ({ _sum: { orderValue: 0 } })) },
    };
    const provider = makeFakeAIProvider(["should never be used"]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await getAdvertisingAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    expect(spy).not.toHaveBeenCalled();
    expect(result.campaigns).toEqual([]);
    expect(result.narrative).toBeNull();
    expect(result.method).toBe("RULE_BASED");
  });

  it("only considers isActive:true campaigns", async () => {
    const deps = makeOrchestrationDeps();
    const provider = makeFakeAIProvider([validNarrativeJson()]);
    await getAdvertisingAnalytics(deps, provider, { companyId: "c1", force: false, now: NOW });
    const findManyArgs = (deps.adCampaign.findMany as any).mock.calls[0][0];
    expect(findManyArgs.where.isActive).toBe(true);
  });
});
