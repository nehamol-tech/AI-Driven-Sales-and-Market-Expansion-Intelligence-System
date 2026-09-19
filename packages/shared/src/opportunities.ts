import type { DailyPriorityLevel } from "./sales-agent.js";
import type { LeadClassification, LeadType, ScoreMethod } from "./leads.js";

export const OPPORTUNITY_TYPES = [
  "REORDER",
  "AT_RISK",
  "CROSS_SELL",
  "HIGH_VALUE",
  "REACTIVATION",
  "GROWING_ACCOUNT",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

/** One real, verified signal behind an opportunity — always computed from the database, never AI-generated. Rendered under "REAL SIGNALS", kept visually distinct from the narrative. */
export interface OpportunityEvidenceItem {
  label: string;
  value: string;
}

/**
 * A deterministically-detected sales opportunity. `type`, `leadId`/`leadType`,
 * `score`/`classification`, `productId`/`productName`, and `evidence` are all
 * computed in code from real data and the AI never touches them.
 * `recommendedAction`/`narrative` are the only AI-eligible fields — phrased
 * from the evidence, with a RULE_BASED template fallback if AI is
 * unavailable/invalid, tracked by `narrativeMethod`.
 *
 * Only Accounts can have opportunities in this phase (every detector needs
 * real order history, which Prospects never have) — `leadType` is kept
 * generic for forward-compatibility, not because Prospects appear today.
 */
export interface OpportunityDTO {
  /** Deterministic, stable across requests: `${type}-${leadId}` (or `${type}-${leadId}-${productId}` for CROSS_SELL, since one account can have more than one). Not a database id — nothing here is persisted. */
  id: string;
  type: OpportunityType;
  leadId: string;
  leadType: LeadType;
  name: string;
  priority: DailyPriorityLevel;
  /** From the account's existing latest LeadScore, verbatim — null if never scored. Never computed or altered here. */
  score: number | null;
  classification: LeadClassification | null;
  /** Only set for CROSS_SELL — always a real Product.id, never invented. */
  productId: string | null;
  productName: string | null;
  evidence: OpportunityEvidenceItem[];
  recommendedAction: string;
  narrative: string | null;
  narrativeMethod: ScoreMethod;
}

export interface OpportunitySummaryDTO {
  generatedAt: string;
  /** Every detected opportunity, counted by type — independent of the narration cap below. */
  counts: Record<OpportunityType, number>;
  highPriorityCount: number;
  /** The top-ranked, AI/RULE_BASED-narrated opportunities (cost-capped) — see `totalOpportunities` for how many more exist. */
  opportunities: OpportunityDTO[];
  totalOpportunities: number;
}

export interface OpportunityQueryFilters {
  type?: OpportunityType;
  priority?: DailyPriorityLevel;
  limit?: number;
}
