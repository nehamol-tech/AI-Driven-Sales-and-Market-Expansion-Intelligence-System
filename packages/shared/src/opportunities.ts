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

/**
 * The 7 Opportunity Center cards: High Priority (every HIGH-priority
 * opportunity, of any type — the same set `highPriorityCount` counts) plus
 * one card per opportunity type (the same sets `counts[type]` counts).
 */
export const OPPORTUNITY_CATEGORIES = ["HIGH_PRIORITY", ...OPPORTUNITY_TYPES] as const;
export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

/**
 * One detected opportunity with its account's figures, for a card's detail
 * list. One row per OPPORTUNITY (not per account) so a list's total always
 * equals its card's count — an account can hold several HIGH-priority
 * opportunities of different types. Every figure is from the same detection
 * snapshot as the counts (`generatedAt`).
 */
export interface OpportunityAccountRowDTO {
  opportunityId: string;
  type: OpportunityType;
  priority: DailyPriorityLevel;
  accountId: string;
  accountName: string;
  industryName: string | null;
  score: number | null;
  classification: LeadClassification | null;
  productName: string | null;
  orderCount: number;
  /** Decimal string, like other money fields in this app. */
  totalOrderValue: string;
  lastOrderDate: string | null;
  /** Whole days since lastOrderDate, as of `generatedAt`. */
  daysSinceLastOrder: number | null;
  evidence: OpportunityEvidenceItem[];
  /** The AI narrative when this opportunity was among the narrated top-N, otherwise its rule-based narrative. */
  reason: string | null;
  recommendedAction: string;
}

export interface OpportunityAccountsResponseDTO {
  data: OpportunityAccountRowDTO[];
  /** `total` is after search/filters — see `categoryTotal` for the card's own count. */
  pagination: { page: number; pageSize: number; total: number };
  category: OpportunityCategory;
  /** Equals the card's count: highPriorityCount for HIGH_PRIORITY, counts[type] otherwise. */
  categoryTotal: number;
  /** Distinct accounts across the whole category (before search/filters). */
  categoryAccountCount: number;
  generatedAt: string;
}

/* -------------------------------------------------------------------------
 * Overdue — accounts with overdue payments, from the FMS "Account_Process"
 * sheet's own Final Status. A separate category from the opportunity
 * types: an account can be Overdue and also High Priority, At Risk, etc.
 * ---------------------------------------------------------------------- */

export const OVERDUE_AGE_BUCKETS = ["1-30", "31-60", "61-90", "90+"] as const;
export type OverdueAgeBucket = (typeof OVERDUE_AGE_BUCKETS)[number];

export const OVERDUE_SORTS = ["amount", "oldest", "recent", "name"] as const;
export type OverdueSort = (typeof OVERDUE_SORTS)[number];

export interface OverdueBillDTO {
  billNo: string;
  /** The sheet's "Date" (bill/order timestamp), as recorded. */
  billDate: string;
  /** The sheet's due date (its "Days O/S" column holds the due date), as recorded. */
  dueDate: string;
  /** Calendar days from the due date to `asOfDate` (India time); null if the due date can't be read. */
  daysOverdue: number | null;
  /** Decimal strings. */
  billAmount: string;
  balanceDue: string;
  /** The sheet's "Payment Received" (Bill Amount − Payment Received = Balance Due); null when blank. Decimal string. */
  paidAmount?: string | null;
  /** The customer name exactly as the payment sheet records it on this bill. */
  customerName?: string;
}

export interface OverdueAccountRowDTO {
  accountId: string;
  accountName: string;
  /** Customer_Database "Code number" for an exact (case-insensitive) customer-name match; null when there is none or several. */
  customerCode: string | null;
  /** Balance Due summed over every bill with a balance (Overdue + Pending). Decimal string. */
  totalOutstanding: string;
  /** Balance Due summed over this account's Overdue bills. Decimal string. */
  overdueAmount: string;
  /** Days overdue of the account's oldest overdue bill — what the age filters use. */
  daysOverdue: number | null;
  /** Every overdue bill, oldest first. */
  overdueBills: OverdueBillDTO[];
  /** Distinct raw "Order Taken" names on these bills' synced orders. */
  orderTakenBy: string[];
  /** This account's opportunities in today's Opportunity Center snapshot. */
  opportunities: { type: OpportunityType; priority: DailyPriorityLevel }[];
}

export interface OverdueSummaryDTO {
  accounts: number;
  totalOverdueAmount: string;
  averageOverdueAmount: string;
  highestOverdueAmount: string;
}

export type OverdueAccountsResponseDTO =
  | { configured: false; message: string }
  | {
      configured: true;
      data: OverdueAccountRowDTO[];
      /** `total` is after search/age filter — `summary` always covers every overdue account. */
      pagination: { page: number; pageSize: number; total: number };
      summary: OverdueSummaryDTO;
      /** Overdue bills that could not be linked to exactly one synced order, so to no account. */
      unlinked: { bills: number; amount: string };
      /** Today's date in India time (YYYY-MM-DD) — the reference for days overdue. */
      asOfDate: string;
      /** When the Apps Script returned the Account_Process sheet. */
      fetchedAt: string;
      retrieval: { complete: boolean; reason: string };
    };

/** One overdue customer's bills (GET /sales-agent/opportunities/overdue/:accountId/bills), paged, oldest first. */
export type OverdueCustomerBillsResponseDTO =
  | { configured: false; message: string }
  | {
      configured: true;
      account: { accountId: string; accountName: string; customerCode: string | null };
      summary: {
        overdueBills: number;
        /** Balance Due summed over the customer's Overdue bills. Decimal string. */
        overdueAmount: string;
        /** Balance Due summed over every bill with a balance (Overdue + Pending). Decimal string. */
        totalOutstanding: string;
      };
      data: OverdueBillDTO[];
      pagination: { page: number; pageSize: number; total: number };
      asOfDate: string;
      fetchedAt: string;
    };

/** One payment-sheet row for a bill, plus its synced FMS order when it can be linked. */
export interface OverdueBillDetailEntryDTO {
  billNo: string;
  customerName: string;
  billDate: string;
  dueDate: string;
  /** The sheet's "Due Days" (credit days); "" when blank. */
  dueDays: string;
  daysOverdue: number | null;
  /** Decimal strings ("" when blank). */
  billAmount: string;
  paidAmount: string;
  balanceDue: string;
  /** The sheet's Final Status, e.g. "Overdue", "Pending", "Paid". */
  finalStatus: string;
  lastFollowUpDate: string;
  lastFollowUpStage: string;
  followUpMode: string;
  customerCaption: string;
  dateReceived: string;
  account: { accountId: string; accountName: string } | null;
  /** The FMS order this bill was synced from (FMS Response), when exactly one matches. */
  order: {
    timestamp: string;
    productAndQty: string;
    orderTaken: string;
    dispatchedBy: string;
    dispatchedDate: string;
    /** The order's value in the database (net of adjustments). Decimal string. */
    orderValue: string;
    cancelled: boolean;
  } | null;
}

/** GET /sales-agent/opportunities/overdue/bills/:billNo — every payment-sheet row with that Bill No. */
export type OverdueBillDetailResponseDTO =
  | { configured: false; message: string }
  | { configured: true; billNo: string; entries: OverdueBillDetailEntryDTO[]; asOfDate: string; fetchedAt: string };
