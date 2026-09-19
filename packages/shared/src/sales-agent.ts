import type { LeadClassification, LeadType, ScoreMethod } from "./leads.js";

export const DAILY_PRIORITY_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type DailyPriorityLevel = (typeof DAILY_PRIORITY_LEVELS)[number];

export const DATA_CONFIDENCE_LEVELS = ["HIGH", "LOW"] as const;
export type DataConfidenceLevel = (typeof DATA_CONFIDENCE_LEVELS)[number];

/**
 * One "today's priority" entry. `score`/`classification` are copied verbatim
 * from the lead's existing (Phase 2) LeadScore — this module never
 * recomputes or overrides them. `priority` is a new deterministic ranking
 * computed in code from real signals (classification, score, reorder
 * timing) — never decided by the AI. `reasons`/`recommendedAction`/
 * `productSuggestion` are the narrative layer: either AI-phrased (grounded
 * strictly in the real facts handed to it) or, if the AI is unavailable/
 * invalid, a `RULE_BASED` template built directly from the same real facts.
 */
export interface SalesAgentPriorityDTO {
  leadId: string;
  leadType: LeadType;
  name: string;
  score: number;
  classification: LeadClassification;
  priority: DailyPriorityLevel;
  reasons: string[];
  recommendedAction: string;
  productSuggestion: string | null;
  narrativeMethod: ScoreMethod;
  dataConfidence: DataConfidenceLevel;
}

export interface SalesAgentTodayDTO {
  generatedAt: string;
  priorities: SalesAgentPriorityDTO[];
  /** How many HOT/WARM scored leads exist beyond what's returned — drives a "View all" affordance. */
  totalCandidates: number;
}
