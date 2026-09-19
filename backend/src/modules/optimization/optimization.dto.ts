/* eslint-disable @typescript-eslint/no-explicit-any */
import type { OptimizationRecommendationDTO } from "@ai-sales/shared";

/** Requires the caller to have included `reviewedBy: { select: { name: true } }` when available. */
export function toOptimizationRecommendationDTO(row: any): OptimizationRecommendationDTO {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    actionType: row.actionType,
    actionParams: (row.actionParams ?? {}) as Record<string, unknown>,
    evidence: (row.evidence ?? {}) as Record<string, unknown>,
    narrative: row.narrative ?? null,
    narrativeMethod: row.narrativeMethod,
    reviewedByUserId: row.reviewedByUserId ?? null,
    reviewedByUserName: row.reviewedBy?.name ?? null,
    reviewedAt: row.reviewedAt ? (row.reviewedAt instanceof Date ? row.reviewedAt : new Date(row.reviewedAt)).toISOString() : null,
    executedAt: row.executedAt ? (row.executedAt instanceof Date ? row.executedAt : new Date(row.executedAt)).toISOString() : null,
    executionResult: row.executionResult ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}
