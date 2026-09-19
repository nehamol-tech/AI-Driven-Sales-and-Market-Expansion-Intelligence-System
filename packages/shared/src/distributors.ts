import type { MarketOpportunityClassification } from "./market-expansion.js";
import type { ScoreMethod } from "./leads.js";

export const DISTRIBUTOR_TYPES = ["DISTRIBUTOR", "DEALER"] as const;
export type DistributorType = (typeof DISTRIBUTOR_TYPES)[number];

export const DISTRIBUTOR_STATUSES = ["PROSPECTIVE", "ACTIVE", "INACTIVE"] as const;
export type DistributorStatus = (typeof DISTRIBUTOR_STATUSES)[number];

export interface DistributorDTO {
  id: string;
  name: string;
  type: DistributorType;
  status: DistributorStatus;
  contactEmail: string | null;
  contactPhone: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  stateIds: string[];
  stateNames: string[];
  onboardedAt: string | null;
  createdAt: string;
}

/**
 * One real state that qualifies for distributor expansion: a real
 * HIGH_OPPORTUNITY/MEDIUM_OPPORTUNITY classification (Phase 4's own scoring
 * engine, reused directly — never re-derived here) AND zero real ACTIVE
 * distributor territory coverage. `opportunityScore`/`opportunityClassification`
 * are always Phase 4's real, already-computed values.
 */
export interface ExpansionRecommendationDTO {
  stateId: string;
  stateName: string;
  opportunityScore: number;
  opportunityClassification: MarketOpportunityClassification;
  /** Always 0 for every recommendation returned, by construction — real, not implied. */
  distributorCoverageCount: number;
}

/**
 * A real distributor's performance. `totalRevenue`/`orderCount` are plain,
 * always-fully-known numbers — a distributor with zero linked SalesRecords
 * still appears with "0"/0, never omitted (mirrors dashboard.service.ts's
 * "a COUNT is always known, even at zero" precedent — these are NOT
 * MetricValues).
 */
export interface DistributorPerformanceDTO {
  distributorId: string;
  name: string;
  type: DistributorType;
  totalRevenue: string;
  orderCount: number;
}

export interface DistributorExpansionSummaryDTO {
  generatedAt: string;
  recommendations: ExpansionRecommendationDTO[];
  performance: DistributorPerformanceDTO[];
  /** null only when there are zero recommendations AND zero distributors to narrate (the AI is never called in that case). */
  narrative: string | null;
  narrativeMethod: ScoreMethod;
}
