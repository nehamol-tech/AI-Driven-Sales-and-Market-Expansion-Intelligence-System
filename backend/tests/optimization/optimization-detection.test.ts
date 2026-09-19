import { describe, it, expect } from "vitest";
import type { CampaignAnalyticsDTO, ExpansionRecommendationDTO } from "@ai-sales/shared";
import {
  detectUnderperformingCampaigns,
  buildDistributorAdvisoryCandidates,
  detectFollowUpCandidates,
  UNDERPERFORMING_ROAS_THRESHOLD,
  DISTRIBUTOR_ADVISORY_LIMIT,
  SCHEDULE_FOLLOW_UP_DUE_IN_DAYS,
  type FollowUpCandidateInput,
} from "../../src/modules/optimization/optimization-detection.js";

function makeCampaign(overrides: Partial<CampaignAnalyticsDTO> = {}): CampaignAnalyticsDTO {
  return {
    campaignId: "camp_1",
    campaignName: "Summer Push",
    platform: "META",
    source: "MANUAL",
    totalSpend: "1000",
    leadsGenerated: 10,
    leadsWon: 2,
    costPerLead: { status: "ok", value: "100" },
    attributedRevenue: { status: "ok", value: "800" },
    roas: { status: "ok", value: 0.8 },
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * detectUnderperformingCampaigns
 * ---------------------------------------------------------------------- */

describe("detectUnderperformingCampaigns", () => {
  it("includes a campaign with a real ROAS below the threshold", () => {
    const campaigns = [makeCampaign({ campaignId: "c1", roas: { status: "ok", value: 0.8 } })];
    expect(detectUnderperformingCampaigns(campaigns).map((c) => c.campaignId)).toEqual(["c1"]);
  });

  it("excludes a campaign with a real ROAS above the threshold", () => {
    const campaigns = [makeCampaign({ campaignId: "c2", roas: { status: "ok", value: 1.5 } })];
    expect(detectUnderperformingCampaigns(campaigns)).toHaveLength(0);
  });

  it("excludes a campaign with a ROAS exactly AT the threshold (< threshold, not <=)", () => {
    const campaigns = [makeCampaign({ campaignId: "c3", roas: { status: "ok", value: UNDERPERFORMING_ROAS_THRESHOLD } })];
    expect(detectUnderperformingCampaigns(campaigns)).toHaveLength(0);
  });

  it("excludes a campaign with insufficient_data ROAS — never flagged without real evidence", () => {
    const campaigns = [makeCampaign({ campaignId: "c4", roas: { status: "insufficient_data" } })];
    expect(detectUnderperformingCampaigns(campaigns)).toHaveLength(0);
  });

  it("returns an empty array for an empty input", () => {
    expect(detectUnderperformingCampaigns([])).toEqual([]);
  });

  it("filters a mixed batch correctly, preserving order", () => {
    const campaigns = [
      makeCampaign({ campaignId: "under1", roas: { status: "ok", value: 0.5 } }),
      makeCampaign({ campaignId: "over1", roas: { status: "ok", value: 2.0 } }),
      makeCampaign({ campaignId: "insufficient1", roas: { status: "insufficient_data" } }),
      makeCampaign({ campaignId: "under2", roas: { status: "ok", value: 0.99 } }),
    ];
    expect(detectUnderperformingCampaigns(campaigns).map((c) => c.campaignId)).toEqual(["under1", "under2"]);
  });
});

/* -------------------------------------------------------------------------
 * buildDistributorAdvisoryCandidates
 * ---------------------------------------------------------------------- */

function makeRecommendation(overrides: Partial<ExpansionRecommendationDTO> = {}): ExpansionRecommendationDTO {
  return {
    stateId: "st_1",
    stateName: "Karnataka",
    opportunityScore: 80,
    opportunityClassification: "HIGH_OPPORTUNITY",
    distributorCoverageCount: 0,
    ...overrides,
  };
}

describe("buildDistributorAdvisoryCandidates", () => {
  it("passes through every recommendation when there are fewer than the limit", () => {
    const recs = [makeRecommendation({ stateId: "s1" }), makeRecommendation({ stateId: "s2" })];
    expect(buildDistributorAdvisoryCandidates(recs).map((r) => r.stateId)).toEqual(["s1", "s2"]);
  });

  it(`caps at DISTRIBUTOR_ADVISORY_LIMIT (${DISTRIBUTOR_ADVISORY_LIMIT}) even when more real recommendations exist`, () => {
    const recs = Array.from({ length: DISTRIBUTOR_ADVISORY_LIMIT + 5 }, (_, i) => makeRecommendation({ stateId: `s${i}` }));
    const result = buildDistributorAdvisoryCandidates(recs);
    expect(result).toHaveLength(DISTRIBUTOR_ADVISORY_LIMIT);
    expect(result.map((r) => r.stateId)).toEqual(recs.slice(0, DISTRIBUTOR_ADVISORY_LIMIT).map((r) => r.stateId));
  });

  it("returns an empty array for an empty input", () => {
    expect(buildDistributorAdvisoryCandidates([])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * detectFollowUpCandidates
 * ---------------------------------------------------------------------- */

describe("detectFollowUpCandidates", () => {
  const NOW = new Date("2026-09-07T00:00:00Z");

  function makeLead(overrides: Partial<FollowUpCandidateInput> = {}): FollowUpCandidateInput {
    return { leadId: "acc_1", leadType: "accounts", leadName: "Acme Retail", classification: "HOT", ...overrides };
  }

  it("excludes a lead that already has a pending follow-up", () => {
    const leads = [makeLead({ leadId: "acc_1" })];
    const pending = new Set(["acc_1"]);
    expect(detectFollowUpCandidates(leads, pending, NOW)).toHaveLength(0);
  });

  it("includes a lead with zero pending follow-ups", () => {
    const leads = [makeLead({ leadId: "acc_2", leadName: "Beta Traders" })];
    const pending = new Set<string>();
    const result = detectFollowUpCandidates(leads, pending, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "SCHEDULE_FOLLOW_UP",
      targetType: "ACCOUNT",
      targetId: "acc_2",
      targetLabel: "Beta Traders",
      actionType: "CREATE_FOLLOW_UP",
    });
  });

  it("maps leadType=prospects to targetType=PROSPECT", () => {
    const leads = [makeLead({ leadId: "p1", leadType: "prospects", leadName: "Prospect Co" })];
    const result = detectFollowUpCandidates(leads, new Set(), NOW);
    expect(result[0].targetType).toBe("PROSPECT");
    expect((result[0].actionParams as { leadType: string }).leadType).toBe("prospects");
  });

  it(`computes a real absolute dueDate exactly ${SCHEDULE_FOLLOW_UP_DUE_IN_DAYS} days from 'now'`, () => {
    const result = detectFollowUpCandidates([makeLead()], new Set(), NOW);
    const dueDate = (result[0].actionParams as { dueDate: string }).dueDate;
    const expected = new Date(NOW.getTime() + SCHEDULE_FOLLOW_UP_DUE_IN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(dueDate).toBe(expected);
  });

  it("carries the real classification into evidence, never inventing one", () => {
    const result = detectFollowUpCandidates([makeLead({ classification: "WARM" })], new Set(), NOW);
    expect(result[0].evidence).toEqual({ classification: "WARM" });
  });

  it("filters a mixed batch correctly, preserving order of survivors", () => {
    const leads = [makeLead({ leadId: "a1" }), makeLead({ leadId: "a2" }), makeLead({ leadId: "a3" })];
    const pending = new Set(["a2"]);
    const result = detectFollowUpCandidates(leads, pending, NOW);
    expect(result.map((c) => c.targetId)).toEqual(["a1", "a3"]);
  });
});
