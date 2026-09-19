import { describe, it, expect, vi } from "vitest";
import { getDashboardInsights, type DashboardInsightsPrismaDeps } from "../../src/modules/dashboard/dashboard-insights.service.js";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";

const NOW = new Date("2026-09-08T00:00:00Z");

function makeAIProvider(): AIProvider {
  return {
    name: "fake",
    async generateCompletion(): Promise<AIProviderCompletion> {
      return { content: "not used — every source below returns pre-baked results", usage: undefined };
    },
  };
}

/**
 * getDashboardInsights composes five ALREADY-EXISTING top-level orchestration
 * functions (getOpportunities / getMarketExpansionSummary /
 * getDistributorExpansionSummary / getAdvertisingAnalytics /
 * getRevenueAnalytics). Rather than re-mock Prisma deep enough to drive each
 * of those five real pipelines end-to-end (which would really just be
 * re-testing those five modules' own already-covered test suites), these
 * tests stub the five imported functions directly and assert only
 * dashboard-insights.service.ts's own composition/ranking/severity logic —
 * exactly the boundary this module owns.
 */
vi.mock("../../src/modules/opportunities/opportunities.service.js", () => ({
  getOpportunities: vi.fn(),
}));
vi.mock("../../src/modules/market-expansion/market-expansion.service.js", () => ({
  getMarketExpansionSummary: vi.fn(),
}));
vi.mock("../../src/modules/distributors/distributor-expansion.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/distributors/distributor-expansion.service.js")>();
  return { ...actual, getDistributorExpansionSummary: vi.fn() };
});
vi.mock("../../src/modules/advertising/advertising-analytics.service.js", () => ({
  getAdvertisingAnalytics: vi.fn(),
}));
vi.mock("../../src/modules/revenue-analytics/revenue-analytics.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/revenue-analytics/revenue-analytics.service.js")>();
  return { ...actual, getRevenueAnalytics: vi.fn() };
});

const { getOpportunities } = await import("../../src/modules/opportunities/opportunities.service.js");
const { getMarketExpansionSummary } = await import("../../src/modules/market-expansion/market-expansion.service.js");
const { getDistributorExpansionSummary } = await import("../../src/modules/distributors/distributor-expansion.service.js");
const { getAdvertisingAnalytics } = await import("../../src/modules/advertising/advertising-analytics.service.js");
const { getRevenueAnalytics } = await import("../../src/modules/revenue-analytics/revenue-analytics.service.js");

function emptyBaseline() {
  (getOpportunities as any).mockResolvedValue({ dto: { opportunities: [] }, wasGenerated: false, method: "RULE_BASED" });
  (getMarketExpansionSummary as any).mockResolvedValue({ dto: { markets: [] }, wasGenerated: false, method: "RULE_BASED" });
  (getDistributorExpansionSummary as any).mockResolvedValue({ recommendations: [], performance: [], narrative: null, narrativeMethod: "RULE_BASED", wasGenerated: false });
  (getAdvertisingAnalytics as any).mockResolvedValue({ campaigns: [], narrative: null, method: "RULE_BASED", wasGenerated: false });
  (getRevenueAnalytics as any).mockResolvedValue({
    dto: { byProduct: [], byState: [], byIndustry: [], bySalesperson: [], byDistributor: [] },
    wasGenerated: false,
    method: "RULE_BASED",
  });
}

const deps = {} as DashboardInsightsPrismaDeps;
const aiProvider = makeAIProvider();

describe("getDashboardInsights", () => {
  it("returns empty problems and opportunities when every source has nothing to report", async () => {
    emptyBaseline();
    const result = await getDashboardInsights(deps, aiProvider, "c1", NOW);
    expect(result).toEqual({ problems: [], opportunities: [] });
  });

  it("maps an AT_RISK opportunity into a problem with the account's own real priority as severity", async () => {
    emptyBaseline();
    (getOpportunities as any).mockResolvedValue({
      dto: {
        opportunities: [
          {
            id: "opp1",
            type: "AT_RISK",
            leadId: "acc1",
            leadType: "accounts",
            name: "Delta Traders",
            priority: "HIGH",
            evidence: [{ label: "Decline", value: "45%" }],
            recommendedAction: "Reach out before the relationship weakens further.",
            narrative: null,
            narrativeMethod: "RULE_BASED",
          },
        ],
      },
      wasGenerated: false,
      method: "RULE_BASED",
    });

    const result = await getDashboardInsights(deps, aiProvider, "c1", NOW);
    expect(result.opportunities).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatchObject({
      category: "ACCOUNT",
      title: "Delta Traders",
      severity: "HIGH",
      changePct: -45,
      detailHref: "/leads/accounts/acc1",
    });
  });

  it("maps CROSS_SELL and GROWING_ACCOUNT opportunities into the opportunities list, never problems", async () => {
    emptyBaseline();
    (getOpportunities as any).mockResolvedValue({
      dto: {
        opportunities: [
          {
            id: "opp2",
            type: "CROSS_SELL",
            leadId: "acc2",
            leadType: "accounts",
            name: "Gamma Corp",
            priority: "MEDIUM",
            evidence: [{ label: "Orders of owned product", value: "5 orders" }],
            recommendedAction: "Introduce the complementary product.",
            narrative: null,
            narrativeMethod: "RULE_BASED",
          },
          {
            id: "opp3",
            type: "GROWING_ACCOUNT",
            leadId: "acc3",
            leadType: "accounts",
            name: "Epsilon Retail",
            priority: "HIGH",
            evidence: [{ label: "Growth", value: "80%" }],
            recommendedAction: "Prioritize this account.",
            narrative: null,
            narrativeMethod: "RULE_BASED",
          },
        ],
      },
      wasGenerated: false,
      method: "RULE_BASED",
    });

    const result = await getDashboardInsights(deps, aiProvider, "c1", NOW);
    expect(result.problems).toEqual([]);
    expect(result.opportunities.map((o) => o.title).sort()).toEqual(["Epsilon Retail", "Gamma Corp"]);
    expect(result.opportunities.find((o) => o.title === "Epsilon Retail")).toMatchObject({ changePct: 80, severity: "HIGH" });
  });

  it("maps a HIGH_OPPORTUNITY market into a TERRITORY opportunity, and drops EMERGING/INSUFFICIENT_DATA states", async () => {
    emptyBaseline();
    (getMarketExpansionSummary as any).mockResolvedValue({
      dto: {
        markets: [
          { stateId: "st1", stateName: "Karnataka", classification: "HIGH_OPPORTUNITY", score: 82, narrative: "Strong internal signal.", evidence: [{ label: "Accounts", value: "5" }] },
          { stateId: "st2", stateName: "Bihar", classification: "EMERGING", score: 12, narrative: null, evidence: [] },
        ],
      },
      wasGenerated: false,
      method: "RULE_BASED",
    });

    const result = await getDashboardInsights(deps, aiProvider, "c1", NOW);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]).toMatchObject({ category: "TERRITORY", title: "Karnataka", severity: "HIGH", changePct: null, detailHref: "/market-expansion/st1" });
  });

  it("maps a real distributor coverage gap into a DISTRIBUTOR opportunity", async () => {
    emptyBaseline();
    (getDistributorExpansionSummary as any).mockResolvedValue({
      recommendations: [{ stateId: "st3", stateName: "Kerala", opportunityScore: 70, opportunityClassification: "HIGH_OPPORTUNITY", distributorCoverageCount: 0 }],
      performance: [],
      narrative: null,
      narrativeMethod: "RULE_BASED",
      wasGenerated: false,
    });

    const result = await getDashboardInsights(deps, aiProvider, "c1", NOW);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]).toMatchObject({ category: "DISTRIBUTOR", title: "Kerala has zero distributor coverage", severity: "HIGH", detailHref: "/distributors" });
  });

  it("maps an active campaign with real ROAS below breakeven into a CAMPAIGN problem, and ignores insufficient_data/above-breakeven campaigns", async () => {
    emptyBaseline();
    (getAdvertisingAnalytics as any).mockResolvedValue({
      campaigns: [
        { campaignId: "camp1", campaignName: "Diwali Push", totalSpend: "50000", roas: { status: "ok", value: 0.5 } },
        { campaignId: "camp2", campaignName: "Healthy Campaign", totalSpend: "10000", roas: { status: "ok", value: 3.2 } },
        { campaignId: "camp3", campaignName: "No Data Yet", totalSpend: "1000", roas: { status: "insufficient_data" } },
      ],
      narrative: null,
      method: "RULE_BASED",
      wasGenerated: false,
    });

    const result = await getDashboardInsights(deps, aiProvider, "c1", NOW);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatchObject({ category: "CAMPAIGN", title: "Diwali Push", severity: "HIGH", detailHref: "/advertising" });
  });

  it("routes growth-aware breakdown items to problems when declining and opportunities when growing, and drops items below the noticeable threshold or with null growthPct", async () => {
    emptyBaseline();
    (getRevenueAnalytics as any).mockResolvedValue({
      dto: {
        byProduct: [
          { id: "p1", name: "Widget A", totalValue: "100000", orderCount: 10, growthPct: -30 },
          { id: "p2", name: "Widget B", totalValue: "80000", orderCount: 8, growthPct: 40 },
          { id: "p3", name: "Widget C (noise)", totalValue: "5000", orderCount: 2, growthPct: -3 },
          { id: "p4", name: "Widget D (no data)", totalValue: "1000", orderCount: 1, growthPct: null },
        ],
        byState: [],
        byIndustry: [],
        bySalesperson: [],
        byDistributor: [{ id: "d1", name: "ABC Distributors", totalValue: "60000", orderCount: 6, growthPct: -15 }],
      },
      wasGenerated: false,
      method: "RULE_BASED",
    });

    const result = await getDashboardInsights(deps, aiProvider, "c1", NOW);

    const problemTitles = result.problems.map((p) => p.title);
    const opportunityTitles = result.opportunities.map((o) => o.title);
    expect(problemTitles).toContain("Widget A");
    expect(problemTitles).toContain("ABC Distributors");
    expect(opportunityTitles).toContain("Widget B");
    expect(problemTitles).not.toContain("Widget C (noise)");
    expect(opportunityTitles).not.toContain("Widget C (noise)");
    expect(problemTitles).not.toContain("Widget D (no data)");
    expect(opportunityTitles).not.toContain("Widget D (no data)");

    const widgetA = result.problems.find((p) => p.title === "Widget A")!;
    expect(widgetA).toMatchObject({ category: "PRODUCT", severity: "HIGH", changePct: -30, detailHref: "/products" });
    const abc = result.problems.find((p) => p.title === "ABC Distributors")!;
    expect(abc).toMatchObject({ category: "DISTRIBUTOR", severity: "MEDIUM", changePct: -15, detailHref: "/distributors" });
  });

  it("ranks each list by severity first, then by real magnitude, and caps at DASHBOARD_INSIGHT_MAX_PER_LIST", async () => {
    emptyBaseline();
    (getRevenueAnalytics as any).mockResolvedValue({
      dto: {
        byProduct: Array.from({ length: 15 }, (_, i) => ({
          id: `p${i}`,
          name: `Product ${i}`,
          totalValue: "10000",
          orderCount: 3,
          growthPct: -(10 + i), // all MEDIUM/HIGH severity, increasing magnitude
        })),
        byState: [],
        byIndustry: [],
        bySalesperson: [],
        byDistributor: [],
      },
      wasGenerated: false,
      method: "RULE_BASED",
    });

    const result = await getDashboardInsights(deps, aiProvider, "c1", NOW);
    expect(result.problems.length).toBeLessThanOrEqual(10);
    // HIGH severity (>=25 magnitude) must all sort ahead of MEDIUM (10-24).
    const severities = result.problems.map((p) => p.severity);
    const firstMediumIndex = severities.indexOf("MEDIUM");
    if (firstMediumIndex !== -1) {
      expect(severities.slice(0, firstMediumIndex).every((s) => s === "HIGH")).toBe(true);
    }
    // Within the same severity band, real magnitude must be descending.
    for (let i = 1; i < result.problems.length; i++) {
      if (result.problems[i - 1].severity === result.problems[i].severity) {
        expect(Math.abs(result.problems[i - 1].changePct!)).toBeGreaterThanOrEqual(Math.abs(result.problems[i].changePct!));
      }
    }
  });
});
