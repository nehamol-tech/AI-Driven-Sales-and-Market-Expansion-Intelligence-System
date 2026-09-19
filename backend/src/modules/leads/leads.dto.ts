/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AccountDTO, LeadScoreDTO, LeadScoreFeedbackDTO, ProspectDTO } from "@ai-sales/shared";

export function toLeadScoreDTO(row: any): LeadScoreDTO {
  return {
    id: row.id,
    score: row.score,
    classification: row.classification,
    method: row.method,
    reasons: row.reasons ?? [],
    recommendedAction: row.recommendedAction ?? { action: "", rationale: "" },
    inputFeatures: row.inputFeatures ?? {},
    provider: row.provider,
    modelName: row.modelName ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}

export interface AccountAggregate {
  orderCount: number;
  totalOrderValue: string;
  lastOrderDate: Date | null;
}

export function toAccountDTO(account: any, aggregate: AccountAggregate, latestScore: any | null): AccountDTO {
  return {
    id: account.id,
    name: account.name,
    stateId: account.stateId ?? null,
    stateName: account.state?.name ?? null,
    cityId: account.cityId ?? null,
    cityName: account.city?.name ?? null,
    industryId: account.industryId ?? null,
    industryName: account.industry?.name ?? null,
    orderCount: aggregate.orderCount,
    totalOrderValue: aggregate.totalOrderValue,
    lastOrderDate: aggregate.lastOrderDate ? aggregate.lastOrderDate.toISOString() : null,
    latestScore: latestScore ? toLeadScoreDTO(latestScore) : null,
    createdAt: (account.createdAt instanceof Date ? account.createdAt : new Date(account.createdAt)).toISOString(),
  };
}

export function toProspectDTO(prospect: any, latestScore: any | null): ProspectDTO {
  return {
    id: prospect.id,
    businessName: prospect.businessName,
    industryId: prospect.industryId ?? null,
    industryName: prospect.industry?.name ?? null,
    businessTypeId: prospect.businessTypeId ?? null,
    businessTypeName: prospect.businessType?.name ?? null,
    stateId: prospect.stateId ?? null,
    stateName: prospect.state?.name ?? null,
    cityId: prospect.cityId ?? null,
    cityName: prospect.city?.name ?? null,
    website: prospect.website ?? null,
    contactEmail: prospect.contactEmail ?? null,
    contactPhone: prospect.contactPhone ?? null,
    source: prospect.source,
    status: prospect.status,
    assignedUserId: prospect.assignedUserId ?? null,
    assignedUserName: prospect.assignedUser?.name ?? null,
    productsOfInterestIds: (prospect.productsOfInterest ?? []).map((p: any) => p.productId as string),
    campaignId: prospect.campaignId ?? null,
    latestScore: latestScore ? toLeadScoreDTO(latestScore) : null,
    createdAt: (prospect.createdAt instanceof Date ? prospect.createdAt : new Date(prospect.createdAt)).toISOString(),
    updatedAt: (prospect.updatedAt instanceof Date ? prospect.updatedAt : new Date(prospect.updatedAt)).toISOString(),
  };
}

export function toLeadScoreFeedbackDTO(row: any): LeadScoreFeedbackDTO {
  return {
    id: row.id,
    leadScoreId: row.leadScoreId,
    userId: row.userId,
    userName: row.user?.name ?? null,
    rating: row.rating,
    comment: row.comment ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}
