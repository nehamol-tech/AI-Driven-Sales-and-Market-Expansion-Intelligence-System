import type { MetricValue } from "./types.js";

/**
 * Phase 5 pipeline (replaces Phase 2's narrower NEW|CONTACTED|QUALIFIED|
 * DISQUALIFIED|CONVERTED): DISQUALIFIED -> LOST, CONVERTED -> WON, plus three
 * new real stages (RESPONDED, QUOTATION, NEGOTIATION). Only 3 real Prospect
 * rows exist in the dev DB at the time of this change, all NEW, so this is a
 * safe additive-in-spirit change even though it's a value rename.
 */
export const PROSPECT_STATUSES = ["NEW", "CONTACTED", "RESPONDED", "QUALIFIED", "QUOTATION", "NEGOTIATION", "WON", "LOST"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

/** Phase 2 only supports manual entry. Phase 3 adds discovery sources here — no schema change needed then. */
export const PROSPECT_SOURCES = ["MANUAL"] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

export const LEAD_CLASSIFICATIONS = ["HOT", "WARM", "COLD"] as const;
export type LeadClassification = (typeof LEAD_CLASSIFICATIONS)[number];

/** AI = a validated model response. RULE_BASED = the transparent fallback used when the AI call fails. */
export const SCORE_METHODS = ["AI", "RULE_BASED"] as const;
export type ScoreMethod = (typeof SCORE_METHODS)[number];

export const FEEDBACK_RATINGS = ["TOO_HIGH", "ACCURATE", "TOO_LOW"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export type LeadType = "accounts" | "prospects";

export interface LeadScoreReason {
  factor: string;
  signal: "positive" | "negative" | "neutral";
  detail: string;
}

export interface LeadScoreRecommendedAction {
  action: string;
  rationale: string;
}

export interface LeadScoreDTO {
  id: string;
  score: number;
  classification: LeadClassification;
  method: ScoreMethod;
  reasons: LeadScoreReason[];
  recommendedAction: LeadScoreRecommendedAction;
  inputFeatures: Record<string, number | string | boolean>;
  provider: string;
  modelName: string | null;
  createdAt: string;
}

export interface LeadScoreFeedbackDTO {
  id: string;
  leadScoreId: string;
  userId: string;
  userName: string | null;
  rating: FeedbackRating;
  comment: string | null;
  createdAt: string;
}

/** Mirrors the dashboard's MetricValue pattern: a lead without enough real data gets an explicit reason, never a guessed score. */
export type LeadScoreResult =
  | { status: "ok"; score: LeadScoreDTO }
  | { status: "insufficient_data"; missing: string[] };

export interface AccountDTO {
  id: string;
  name: string;
  stateId: string | null;
  stateName: string | null;
  cityId: string | null;
  cityName: string | null;
  industryId: string | null;
  industryName: string | null;
  orderCount: number;
  totalOrderValue: string;
  lastOrderDate: string | null;
  latestScore: LeadScoreDTO | null;
  createdAt: string;
}

export interface ProspectDTO {
  id: string;
  businessName: string;
  industryId: string | null;
  industryName: string | null;
  businessTypeId: string | null;
  businessTypeName: string | null;
  stateId: string | null;
  stateName: string | null;
  cityId: string | null;
  cityName: string | null;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  source: ProspectSource;
  status: ProspectStatus;
  assignedUserId: string | null;
  assignedUserName: string | null;
  productsOfInterestIds: string[];
  /** Phase 7: the AdCampaign this prospect is attributed to, if any — set via prospects create/update, read by advertising-analytics.service.ts's leadsGenerated/leadsWon counts. */
  campaignId: string | null;
  latestScore: LeadScoreDTO | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadBoardEntryDTO {
  leadType: LeadType;
  id: string;
  name: string;
  classification: LeadClassification;
  score: number;
}

export interface LeadSummaryDTO {
  hotCount: MetricValue<number>;
  warmCount: MetricValue<number>;
  coldCount: MetricValue<number>;
  unscoredCount: MetricValue<number>;
  topHotLeads: MetricValue<LeadBoardEntryDTO[]>;
}
