import type { OpportunityEvidenceItem } from "./opportunities.js";
import type { ScoreMethod } from "./leads.js";

export const MARKET_OPPORTUNITY_CLASSIFICATIONS = [
  "HIGH_OPPORTUNITY",
  "MEDIUM_OPPORTUNITY",
  "EMERGING",
  "INSUFFICIENT_DATA",
] as const;
export type MarketOpportunityClassification = (typeof MARKET_OPPORTUNITY_CLASSIFICATIONS)[number];

/** A real product's performance within one state — always from actual SalesRecord data, never invented. */
export interface MarketProductSignal {
  productId: string;
  productName: string;
  orderCount: number;
  totalValue: string;
}

/** A real industry's performance within one state. */
export interface MarketIndustrySignal {
  industryId: string;
  industryName: string;
  accountCount: number;
  orderCount: number;
  totalValue: string;
}

export interface MarketCityBreakdown {
  cityId: string;
  cityName: string;
  orderCount: number;
  totalValue: string;
}

/** Mirrors the dashboard's MetricValue pattern: growth is only ever reported when a real two-period comparison is possible. */
export type MarketGrowthSignal =
  | { status: "ok"; recentValue: string; priorValue: string; growthPct: number }
  | { status: "insufficient_data" };

/**
 * A cautious, hedged expansion idea — never phrased as proven demand. Always
 * anchored to a real product performing well in a real "source" state, and
 * (when present) a real industry match in the state being viewed.
 */
export interface MarketExpansionHypothesis {
  productId: string;
  productName: string;
  sourceStateName: string;
  targetIndustryName: string | null;
  statement: string;
}

/**
 * One state's market summary. `score`/`classification` are 100% deterministic
 * — the AI never computes or alters them. `evidence` is always real,
 * computed data (reuses the same OpportunityEvidenceItem shape Phase 3C
 * established). `narrative` is the only AI-eligible field, with a RULE_BASED
 * fallback, and it may never claim external market demand it has no
 * evidence for — only what this company's own data supports.
 */

/** The six deterministic 0-100 sub-scores that compose the weighted `score`. Exposed so the UI can show them without the frontend ever recomputing anything. Present for every state, including INSUFFICIENT_DATA (where every sub-score is naturally 0). */
export interface MarketSubScoresDTO {
  existingDemand: number;
  customerQuality: number;
  productFit: number;
  industryFit: number;
  growth: number;
  whitespace: number;
}

export interface MarketSummaryDTO {
  stateId: string;
  stateName: string;
  classification: MarketOpportunityClassification;
  /** null only for INSUFFICIENT_DATA — never a guessed number. */
  score: number | null;
  subScores: MarketSubScoresDTO;
  accountCount: number;
  prospectCount: number;
  orderCount: number;
  totalSalesValue: string;
  averageOrderValue: string | null;
  hotAccountCount: number;
  warmAccountCount: number;
  topIndustryName: string | null;
  evidence: OpportunityEvidenceItem[];
  narrative: string | null;
  narrativeMethod: ScoreMethod;
}

export interface MarketDetailDTO extends MarketSummaryDTO {
  cityBreakdown: MarketCityBreakdown[];
  industrySignals: MarketIndustrySignal[];
  productSignals: MarketProductSignal[];
  growthSignal: MarketGrowthSignal;
  expansionHypotheses: MarketExpansionHypothesis[];
}

export interface MarketExpansionSummaryDTO {
  generatedAt: string;
  /** Ranked (score desc), narrated markets — states with at least some real evidence. INSUFFICIENT_DATA states are excluded here (nothing to rank or narrate) but counted in totals below. */
  markets: MarketSummaryDTO[];
  /** How many real seeded states have at least one account/prospect/order. */
  totalStatesWithData: number;
  /** Every state in the reference table, regardless of data. */
  totalStatesAnalyzed: number;
}

export interface MarketExpansionQueryFilters {
  limit?: number;
}
