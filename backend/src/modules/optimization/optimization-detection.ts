import type { CampaignAnalyticsDTO, ExpansionRecommendationDTO, OptimizationRecommendationType, OptimizationTargetType } from "@ai-sales/shared";

/**
 * Real, self-explanatory business fact, not a guessed number: spend
 * exceeding attributed revenue (ROAS < 1) means the campaign is losing money
 * on a real-revenue basis.
 */
export const UNDERPERFORMING_ROAS_THRESHOLD = 1;

/** Caps how many of Phase 8's already-ranked expansion recommendations become optimization candidates — cost/UI control, mirrors OPPORTUNITIES_DEFAULT_LIMIT's precedent. */
export const DISTRIBUTOR_ADVISORY_LIMIT = 3;

/**
 * The pre-persistence candidate shape — every field here is 100%
 * deterministic and computed BEFORE any AI call. The AI later narrates from
 * this object but can never see or alter targetId/actionType/actionParams —
 * it may only ever produce a `narrative` string keyed by the candidate's real
 * persisted id (assigned at persistence time in optimization.service.ts).
 */
export interface OptimizationCandidate {
  type: OptimizationRecommendationType;
  targetType: OptimizationTargetType;
  targetId: string;
  targetLabel: string;
  actionType: string;
  actionParams: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

/* -------------------------------------------------------------------------
 * SCHEDULE_FOLLOW_UP — a real HOT/WARM-classified lead (Phase 2's own
 * `leadScore.isLatest` classification, reused verbatim, never re-derived)
 * with zero pending follow-ups on file. Pure: the caller has already
 * resolved which lead ids have a pending follow-up (leadIdsWithPendingFollowUp)
 * via one batched query — this function only filters/maps.
 * ---------------------------------------------------------------------- */

export interface FollowUpCandidateInput {
  leadId: string;
  leadType: "accounts" | "prospects";
  leadName: string;
  classification: "HOT" | "WARM";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many days out a freshly-recommended (non-at-risk) follow-up should be due — a near-term but not urgent nudge. */
export const SCHEDULE_FOLLOW_UP_DUE_IN_DAYS = 3;

/**
 * `now` is taken as an explicit parameter (never read internally) so the
 * absolute `dueDate` embedded in `actionParams` is a real, deterministic
 * value computed once at detection time — mirroring detectAtRisk's own
 * signature convention (detectors.ts) exactly.
 */
export function detectFollowUpCandidates(leads: FollowUpCandidateInput[], leadIdsWithPendingFollowUp: Set<string>, now: Date): OptimizationCandidate[] {
  const dueDate = new Date(now.getTime() + SCHEDULE_FOLLOW_UP_DUE_IN_DAYS * MS_PER_DAY).toISOString();

  return leads
    .filter((lead) => !leadIdsWithPendingFollowUp.has(lead.leadId))
    .map((lead) => ({
      type: "SCHEDULE_FOLLOW_UP" as const,
      targetType: (lead.leadType === "accounts" ? "ACCOUNT" : "PROSPECT") as OptimizationTargetType,
      targetId: lead.leadId,
      targetLabel: lead.leadName,
      actionType: "CREATE_FOLLOW_UP",
      actionParams: {
        leadId: lead.leadId,
        leadType: lead.leadType,
        dueDate,
        notes: null,
      },
      evidence: { classification: lead.classification },
    }));
}

/* -------------------------------------------------------------------------
 * AT_RISK_FOLLOW_UP candidates are built directly by optimization.service.ts
 * (it already has real AccountProfile[] from gatherAccountProfiles and calls
 * detectAtRisk from opportunities/detectors.ts itself) — no pure helper is
 * needed here beyond the shared pending-follow-up filtering pattern already
 * used above.
 * ---------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
 * PAUSE_UNDERPERFORMING_CAMPAIGN — a real active campaign whose real,
 * already-computed ROAS (Phase 7's computeCampaignAnalytics, reused
 * verbatim) is a known, unfavorable number: spend exceeds attributed
 * revenue. `insufficient_data` campaigns are never flagged — there is no
 * real evidence to act on.
 * ---------------------------------------------------------------------- */

export function detectUnderperformingCampaigns(campaigns: CampaignAnalyticsDTO[]): CampaignAnalyticsDTO[] {
  return campaigns.filter((c) => c.roas.status === "ok" && c.roas.value < UNDERPERFORMING_ROAS_THRESHOLD);
}

/* -------------------------------------------------------------------------
 * DISTRIBUTOR_EXPANSION_ADVISORY — the top N of Phase 8's own already-ranked
 * expansion recommendations. Purely advisory (no mutation exists for
 * "assign a distributor to a state" in this schema) — approving one is just
 * a human acknowledgment, never an executed action.
 * ---------------------------------------------------------------------- */

export function buildDistributorAdvisoryCandidates(recommendations: ExpansionRecommendationDTO[]): ExpansionRecommendationDTO[] {
  return recommendations.slice(0, DISTRIBUTOR_ADVISORY_LIMIT);
}
