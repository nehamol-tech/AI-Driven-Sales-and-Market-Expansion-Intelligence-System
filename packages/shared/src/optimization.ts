import type { ScoreMethod } from "./leads.js";

/**
 * Phase 9 — AI Autonomous Optimization. The AI never decides WHAT the
 * recommendation is (that's deterministic detection reusing Phases 3C/7/8's
 * already-computed real signals) or executes anything — it only narrates WHY
 * a real, already-detected candidate makes sense. Every actual state change
 * happens only after an explicit human (ADMIN/MANAGER) approval, and always
 * through an existing, already-tested service function from the phase that
 * owns that entity (createFollowUp / updateCampaign) — this phase introduces
 * zero new business-mutation logic.
 */
export const OPTIMIZATION_RECOMMENDATION_TYPES = [
  "SCHEDULE_FOLLOW_UP",
  "AT_RISK_FOLLOW_UP",
  "PAUSE_UNDERPERFORMING_CAMPAIGN",
  "DISTRIBUTOR_EXPANSION_ADVISORY",
] as const;
export type OptimizationRecommendationType = (typeof OPTIMIZATION_RECOMMENDATION_TYPES)[number];

export const OPTIMIZATION_RECOMMENDATION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXECUTED", "EXECUTION_FAILED"] as const;
export type OptimizationRecommendationStatus = (typeof OPTIMIZATION_RECOMMENDATION_STATUSES)[number];

export const OPTIMIZATION_TARGET_TYPES = ["ACCOUNT", "PROSPECT", "AD_CAMPAIGN", "STATE"] as const;
export type OptimizationTargetType = (typeof OPTIMIZATION_TARGET_TYPES)[number];

export interface OptimizationExecutionResult {
  success: boolean;
  message?: string;
  createdEntityId?: string;
}

export interface OptimizationRecommendationDTO {
  id: string;
  type: OptimizationRecommendationType;
  status: OptimizationRecommendationStatus;
  targetType: OptimizationTargetType;
  targetId: string;
  targetLabel: string;
  actionType: string;
  actionParams: Record<string, unknown>;
  evidence: Record<string, unknown>;
  narrative: string | null;
  narrativeMethod: ScoreMethod;
  reviewedByUserId: string | null;
  reviewedByUserName: string | null;
  reviewedAt: string | null;
  executedAt: string | null;
  executionResult: OptimizationExecutionResult | null;
  createdAt: string;
}

export interface GenerateRecommendationsResultDTO {
  created: OptimizationRecommendationDTO[];
  skippedDuplicates: number;
}

export interface PaginatedOptimizationRecommendationsDTO {
  items: OptimizationRecommendationDTO[];
  total: number;
  page: number;
  pageSize: number;
}
