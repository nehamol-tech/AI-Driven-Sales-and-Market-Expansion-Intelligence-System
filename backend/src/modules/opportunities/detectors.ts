import type { DailyPriorityLevel, LeadClassification, OpportunityEvidenceItem, OpportunityType } from "@ai-sales/shared";
import type { AccountProfile, CrossSellProductCandidate } from "./account-profile.service.js";
import { computeWindowComparison } from "./account-profile.service.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatINR(value: number): string {
  return Math.round(value).toLocaleString("en-IN");
}

function toDateLabel(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "unknown";
}

/* -------------------------------------------------------------------------
 * A detected opportunity, before AI/RULE_BASED narration is applied.
 * `ruleBasedNarrative`/`ruleBasedRecommendedAction` are computed here,
 * directly from the same real facts as `evidence` — always available even
 * before any AI call, and used verbatim as the RULE_BASED fallback (mirrors
 * priority.service.ts's deterministicReasons + buildRuleBasedRecommendedAction
 * pattern, but consolidated per-detector since each opportunity type's
 * template differs substantially).
 * ---------------------------------------------------------------------- */

export interface OpportunityCandidate {
  id: string;
  type: OpportunityType;
  leadId: string;
  leadType: "accounts";
  name: string;
  priority: DailyPriorityLevel;
  score: number | null;
  classification: LeadClassification | null;
  productId: string | null;
  productName: string | null;
  evidence: OpportunityEvidenceItem[];
  /** Secondary rank signal (priority is the primary sort key) — see rankOpportunityCandidates in opportunities.service.ts. Always a real computed number (overdue days, decline/growth %, order value, etc.), never invented. */
  rankSignal: number;
  ruleBasedNarrative: string;
  ruleBasedRecommendedAction: string;
}

/* =========================================================================
 * Every detector below is a PURE function: no AI, no I/O. All thresholds
 * are named, exported constants with a documented rationale so they can be
 * tuned in one place. An account CAN legitimately satisfy more than one
 * detector at once (e.g. REORDER + HIGH_VALUE) — that's correct, expected
 * behavior, not a bug to dedupe away; opportunities.service.ts intentionally
 * keeps every fired candidate.
 *
 * None of these detectors read anything from Company / CompanyOperatingState
 * / CompanyTargetState — every signal here is derived purely from Account +
 * Product (+ its target-industry/business-type joins) + SalesRecord + the
 * account's existing latest LeadScore, per the Phase 3C spec.
 * ========================================================================= */

/* -------------------------------------------------------------------------
 * REORDER — a real, computable reorder cycle (>=2 orders, reusing
 * computeReorderTiming's own >=2 gate so a cycle is never fabricated from a
 * single order) that is genuinely PAST due, not merely "coming due" (Phase
 * 3A/3B use a softer "due soon" framing with a negative-day allowance —
 * this type is deliberately stricter: overdueByDays must be > 0).
 * ---------------------------------------------------------------------- */

/** Genuinely past due, not just "coming due" (0, not a negative allowance like Phase 3A/3B's reorder_soon). */
export const REORDER_MIN_OVERDUE_DAYS = 0;
/** >=3 weeks past the account's own usual cycle is a strong, unambiguous signal. */
export const REORDER_PRIORITY_HIGH_OVERDUE_DAYS = 21;
/** >=1 week past cycle is a real signal worth flagging even if not urgent yet. */
export const REORDER_PRIORITY_MEDIUM_OVERDUE_DAYS = 7;

export function detectReorder(profile: AccountProfile): OpportunityCandidate | null {
  if (profile.orderCount < 2) return null;
  if (profile.overdueByDays === null || profile.averageReorderIntervalDays === null) return null;
  if (profile.overdueByDays <= REORDER_MIN_OVERDUE_DAYS) return null;

  const overdue = profile.overdueByDays;
  const avgCycle = profile.averageReorderIntervalDays;
  const overdueRounded = Math.round(overdue);
  const cycleRounded = Math.round(avgCycle);

  const priority: DailyPriorityLevel =
    overdue >= REORDER_PRIORITY_HIGH_OVERDUE_DAYS ? "HIGH" : overdue >= REORDER_PRIORITY_MEDIUM_OVERDUE_DAYS ? "MEDIUM" : "LOW";

  const evidence: OpportunityEvidenceItem[] = [
    { label: "Order count", value: `${profile.orderCount} orders` },
    { label: "Average reorder cycle", value: `~${cycleRounded} days` },
    { label: "Days overdue", value: `${overdueRounded} days` },
    { label: "Last order", value: toDateLabel(profile.lastOrderDate) },
  ];

  return {
    id: `REORDER-${profile.id}`,
    type: "REORDER",
    leadId: profile.id,
    leadType: "accounts",
    name: profile.name,
    priority,
    score: profile.latestScore,
    classification: profile.latestClassification,
    productId: null,
    productName: null,
    evidence,
    rankSignal: overdue,
    ruleBasedNarrative: `${profile.name} is ${overdueRounded} day${overdueRounded === 1 ? "" : "s"} overdue for its usual ~${cycleRounded}-day reorder cycle (${profile.orderCount} real orders on file).`,
    ruleBasedRecommendedAction:
      priority === "HIGH" ? "Contact today to place a reorder." : priority === "MEDIUM" ? "Follow up this week about a reorder." : "Check in about a reorder soon.",
  };
}

/* -------------------------------------------------------------------------
 * AT_RISK — a genuine documented DECLINE between two adjacent real order
 * windows, not a disguised "no order in X days" rule (that already exists
 * as REACTIVATION). Requires enough real history that the trend comparison
 * is meaningful, and requires real prior-period activity to decline FROM —
 * an account with zero orders in the prior window has nothing to compare
 * against and is left to REACTIVATION instead.
 * ---------------------------------------------------------------------- */

/** Below this many total real orders, a two-period trend comparison isn't meaningful. */
export const AT_RISK_MIN_TOTAL_ORDERS = 3;
/** The account's real order history must span at least this long (first to last order) for "decline" to mean something beyond noise. */
export const AT_RISK_MIN_SPAN_DAYS = 60;
/** Width of each comparison window (recent vs prior). 60 days (~2 months) balances enough volume per window against staying recent. */
export const AT_RISK_WINDOW_DAYS = 60;
/** A genuine, not-marginal drop — 40% fewer orders/value than the prior window. */
export const AT_RISK_DECLINE_THRESHOLD = 0.4;
/** A drop this severe (>=70%) is treated as urgent. */
export const AT_RISK_PRIORITY_HIGH_DECLINE = 0.7;

export function detectAtRisk(profile: AccountProfile, now: Date): OpportunityCandidate | null {
  if (profile.orderCount < AT_RISK_MIN_TOTAL_ORDERS) return null;
  if (!profile.firstOrderDate || !profile.lastOrderDate) return null;

  const spanDays = (profile.lastOrderDate.getTime() - profile.firstOrderDate.getTime()) / MS_PER_DAY;
  if (spanDays < AT_RISK_MIN_SPAN_DAYS) return null;

  const cmp = computeWindowComparison(profile.orders, now, AT_RISK_WINDOW_DAYS);
  if (cmp.priorValue <= 0) return null; // no real prior activity to decline from

  const declinePct = (cmp.priorValue - cmp.recentValue) / cmp.priorValue;
  if (declinePct < AT_RISK_DECLINE_THRESHOLD) return null;

  const priority: DailyPriorityLevel = declinePct >= AT_RISK_PRIORITY_HIGH_DECLINE ? "HIGH" : "MEDIUM";
  const declinePctRounded = Math.round(declinePct * 100);

  const evidence: OpportunityEvidenceItem[] = [
    { label: "Recent window", value: `${cmp.recentCount} order${cmp.recentCount === 1 ? "" : "s"}, ₹${formatINR(cmp.recentValue)} (last ${AT_RISK_WINDOW_DAYS} days)` },
    { label: "Prior window", value: `${cmp.priorCount} order${cmp.priorCount === 1 ? "" : "s"}, ₹${formatINR(cmp.priorValue)} (${AT_RISK_WINDOW_DAYS}-${2 * AT_RISK_WINDOW_DAYS} days ago)` },
    { label: "Decline", value: `${declinePctRounded}%` },
  ];

  return {
    id: `AT_RISK-${profile.id}`,
    type: "AT_RISK",
    leadId: profile.id,
    leadType: "accounts",
    name: profile.name,
    priority,
    score: profile.latestScore,
    classification: profile.latestClassification,
    productId: null,
    productName: null,
    evidence,
    rankSignal: declinePct,
    ruleBasedNarrative: `${profile.name}'s order value dropped ${declinePctRounded}% in the last ${AT_RISK_WINDOW_DAYS} days (₹${formatINR(cmp.recentValue)}) versus the prior ${AT_RISK_WINDOW_DAYS} days (₹${formatINR(cmp.priorValue)}).`,
    ruleBasedRecommendedAction: priority === "HIGH" ? "Reach out immediately — this account shows a real risk of churning." : "Check in with this account to understand the recent drop-off.",
  };
}

/* -------------------------------------------------------------------------
 * GROWING_ACCOUNT — the mirror of AT_RISK: a genuine documented INCREASE
 * between two adjacent real order windows.
 * ---------------------------------------------------------------------- */

export const GROWING_MIN_TOTAL_ORDERS = 4;
export const GROWING_MIN_SPAN_DAYS = 60;
export const GROWING_WINDOW_DAYS = 60;
export const GROWING_THRESHOLD = 0.4;
/** Growth this strong (>=100%, i.e. doubled) is treated as a stronger signal. */
export const GROWING_PRIORITY_HIGH_GROWTH = 1.0;

export function detectGrowingAccount(profile: AccountProfile, now: Date): OpportunityCandidate | null {
  if (profile.orderCount < GROWING_MIN_TOTAL_ORDERS) return null;
  if (!profile.firstOrderDate || !profile.lastOrderDate) return null;

  const spanDays = (profile.lastOrderDate.getTime() - profile.firstOrderDate.getTime()) / MS_PER_DAY;
  if (spanDays < GROWING_MIN_SPAN_DAYS) return null;

  const cmp = computeWindowComparison(profile.orders, now, GROWING_WINDOW_DAYS);
  if (cmp.priorValue <= 0) return null; // no real prior activity to grow from

  const growthPct = (cmp.recentValue - cmp.priorValue) / cmp.priorValue;
  if (growthPct < GROWING_THRESHOLD) return null;

  const priority: DailyPriorityLevel = growthPct >= GROWING_PRIORITY_HIGH_GROWTH ? "HIGH" : "MEDIUM";
  const growthPctRounded = Math.round(growthPct * 100);

  const evidence: OpportunityEvidenceItem[] = [
    { label: "Recent window", value: `${cmp.recentCount} order${cmp.recentCount === 1 ? "" : "s"}, ₹${formatINR(cmp.recentValue)} (last ${GROWING_WINDOW_DAYS} days)` },
    { label: "Prior window", value: `${cmp.priorCount} order${cmp.priorCount === 1 ? "" : "s"}, ₹${formatINR(cmp.priorValue)} (${GROWING_WINDOW_DAYS}-${2 * GROWING_WINDOW_DAYS} days ago)` },
    { label: "Growth", value: `${growthPctRounded}%` },
  ];

  return {
    id: `GROWING_ACCOUNT-${profile.id}`,
    type: "GROWING_ACCOUNT",
    leadId: profile.id,
    leadType: "accounts",
    name: profile.name,
    priority,
    score: profile.latestScore,
    classification: profile.latestClassification,
    productId: null,
    productName: null,
    evidence,
    rankSignal: growthPct,
    ruleBasedNarrative: `${profile.name}'s order value grew ${growthPctRounded}% in the last ${GROWING_WINDOW_DAYS} days (₹${formatINR(cmp.recentValue)}) versus the prior ${GROWING_WINDOW_DAYS} days (₹${formatINR(cmp.priorValue)}).`,
    ruleBasedRecommendedAction: priority === "HIGH" ? "This account is growing fast — check in about expanding the relationship." : "Explore expanding this account further.",
  };
}

/* -------------------------------------------------------------------------
 * CROSS_SELL — the only real "product relationship" data in this schema is
 * a product's target-industry/target-business-type list; there is no
 * product-bundle/complementary-product table. "Complementary" here
 * explicitly means "matches this account's real industry profile the same
 * way Phase 3A/3B's product-fit already works" (findMatchingProductNames'
 * matching rule, adapted per-account) — NOT a curated bundle relationship.
 * Requires a real repeat-purchase pattern on some owned product (>=2 real
 * orders of it), never a one-off trial.
 * ---------------------------------------------------------------------- */

export const CROSS_SELL_MIN_OWNED_ORDERS = 2;
/** Caps candidate opportunities per account to avoid spamming the narrated list with every possible pairing. */
export const CROSS_SELL_MAX_PER_ACCOUNT = 2;
/** An owned product bought this many times (or more) is a strong repeat-purchase signal. */
export const CROSS_SELL_STRONG_SIGNAL_ORDERS = 4;

function matchCriteriaCount(product: CrossSellProductCandidate, industryId: string | null, businessTypeId: string | null): number {
  let n = 0;
  if (industryId !== null && product.targetIndustryIds.includes(industryId)) n += 1;
  if (businessTypeId !== null && product.targetBusinessTypeIds.includes(businessTypeId)) n += 1;
  return n;
}

export function detectCrossSell(profile: AccountProfile, products: CrossSellProductCandidate[]): OpportunityCandidate[] {
  if (profile.orders.length === 0) return [];

  const orderCountByProduct = new Map<string, number>();
  for (const o of profile.orders) {
    if (!o.productId) continue;
    orderCountByProduct.set(o.productId, (orderCountByProduct.get(o.productId) ?? 0) + 1);
  }

  const ownedQualifying = Array.from(orderCountByProduct.entries())
    .filter(([, count]) => count >= CROSS_SELL_MIN_OWNED_ORDERS)
    .sort((a, b) => b[1] - a[1]); // strongest repeat-purchase signal first
  if (ownedQualifying.length === 0) return [];

  const ownedProductIds = new Set(profile.distinctOwnedProductIds);
  // Real candidate products: active, not already owned, whose target industry/business type
  // matches this account's real industry (businessTypeId is always null for Account, so only
  // the industry match applies today — the businessType branch is kept for forward-compat with
  // a future Prospect-facing cross-sell pass, per detectCrossSell's own doc comment above).
  const matchingCandidates = products
    .filter((p) => !ownedProductIds.has(p.id) && matchCriteriaCount(p, profile.industryId, profile.businessTypeId) > 0)
    .sort((a, b) => {
      const diff = matchCriteriaCount(b, profile.industryId, profile.businessTypeId) - matchCriteriaCount(a, profile.industryId, profile.businessTypeId);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  if (matchingCandidates.length === 0) return [];

  const productById = new Map(products.map((p) => [p.id, p]));
  const alreadySuggested = new Set<string>();
  const results: OpportunityCandidate[] = [];

  for (const [ownedProductId, ownedCount] of ownedQualifying) {
    if (results.length >= CROSS_SELL_MAX_PER_ACCOUNT) break;
    const nextCandidate = matchingCandidates.find((c) => !alreadySuggested.has(c.id));
    if (!nextCandidate) break; // no more distinct real matches to suggest
    alreadySuggested.add(nextCandidate.id);

    const ownedProduct = productById.get(ownedProductId);
    const ownedProductName = ownedProduct?.name ?? "an owned product";
    const priority: DailyPriorityLevel = ownedCount >= CROSS_SELL_STRONG_SIGNAL_ORDERS ? "HIGH" : "MEDIUM";
    const industryLabel = profile.industryName ?? "this account's industry";

    const evidence: OpportunityEvidenceItem[] = [
      { label: "Owned product", value: ownedProductName },
      { label: "Orders of owned product", value: `${ownedCount} orders` },
      { label: "Matched industry", value: industryLabel },
    ];

    results.push({
      id: `CROSS_SELL-${profile.id}-${nextCandidate.id}`,
      type: "CROSS_SELL",
      leadId: profile.id,
      leadType: "accounts",
      name: profile.name,
      priority,
      score: profile.latestScore,
      classification: profile.latestClassification,
      productId: nextCandidate.id,
      productName: nextCandidate.name,
      evidence,
      rankSignal: ownedCount,
      ruleBasedNarrative: `${profile.name} has ordered ${ownedProductName} ${ownedCount} times and matches ${nextCandidate.name}'s target industry (${industryLabel}).`,
      ruleBasedRecommendedAction: `Suggest ${nextCandidate.name} on the next call.`,
    });
  }

  return results;
}

/* -------------------------------------------------------------------------
 * Top-value-percentile helper — shared by HIGH_VALUE and REACTIVATION.
 * Self-calibrating to the real company data instead of a guessed absolute
 * rupee figure: computes the top N% of accounts-with->=1-order by real
 * totalOrderValue.
 * ---------------------------------------------------------------------- */

/** Top quartile by real total order value, among accounts with >=1 real order. */
export const HIGH_VALUE_TOP_PERCENTILE = 25;

export interface TopValueInfo {
  accountIds: Set<string>;
  /** accountId -> 1-based rank by totalOrderValue desc, among accounts with orderCount >= 1. */
  rankByAccountId: Map<string, number>;
  totalRankedAccounts: number;
}

export function computeTopValueAccounts(profiles: AccountProfile[], topPercentile: number): TopValueInfo {
  const ranked = profiles
    .filter((p) => p.orderCount > 0)
    .slice()
    .sort((a, b) => b.totalOrderValue - a.totalOrderValue);

  const rankByAccountId = new Map<string, number>();
  ranked.forEach((p, i) => rankByAccountId.set(p.id, i + 1));

  if (ranked.length === 0) {
    return { accountIds: new Set(), rankByAccountId, totalRankedAccounts: 0 };
  }

  const topCount = Math.max(1, Math.ceil(ranked.length * (topPercentile / 100)));
  const accountIds = new Set(ranked.slice(0, topCount).map((p) => p.id));

  return { accountIds, rankByAccountId, totalRankedAccounts: ranked.length };
}

/* -------------------------------------------------------------------------
 * HIGH_VALUE — NOT "every high-revenue customer". Requires BOTH real
 * top-quartile total order value AND at least one other real actionable
 * signal for the SAME account. Runs as a second pass after the other 5
 * detectors so it can check their real results (never reimplements their
 * logic) — see opportunities.service.ts's orchestration.
 * ---------------------------------------------------------------------- */

export interface HighValueCoSignals {
  hasReorder: boolean;
  hasAtRisk: boolean;
  crossSellCount: number;
  hasReactivation: boolean;
  hasGrowing: boolean;
}

const HIGH_VALUE_CO_SIGNAL_LABELS: Record<keyof HighValueCoSignals | "hot", string> = {
  hasReorder: "Also overdue for reorder",
  hasAtRisk: "Also showing a real recent order decline (AT_RISK)",
  crossSellCount: "Also has a real cross-sell match on file",
  hasReactivation: "Also dormant and eligible for reactivation",
  hasGrowing: "Also showing real recent order growth",
  hot: "Latest lead score is HOT",
};

export function detectHighValue(profile: AccountProfile, topValueInfo: TopValueInfo, coSignals: HighValueCoSignals): OpportunityCandidate | null {
  if (!topValueInfo.accountIds.has(profile.id)) return null;

  let coSignalKey: keyof typeof HIGH_VALUE_CO_SIGNAL_LABELS | null = null;
  if (coSignals.hasReorder) coSignalKey = "hasReorder";
  else if (coSignals.hasAtRisk) coSignalKey = "hasAtRisk";
  else if (coSignals.crossSellCount > 0) coSignalKey = "crossSellCount";
  else if (coSignals.hasReactivation) coSignalKey = "hasReactivation";
  else if (coSignals.hasGrowing) coSignalKey = "hasGrowing";
  else if (profile.latestClassification === "HOT") coSignalKey = "hot";

  if (!coSignalKey) return null; // value alone is never enough

  const coSignalLabel = HIGH_VALUE_CO_SIGNAL_LABELS[coSignalKey];
  const rank = topValueInfo.rankByAccountId.get(profile.id) ?? null;
  const total = topValueInfo.totalRankedAccounts;
  const rankLabel = rank !== null ? `#${rank} of ${total} accounts with real orders` : `top ${HIGH_VALUE_TOP_PERCENTILE}% by order value`;

  const evidence: OpportunityEvidenceItem[] = [
    { label: "Total order value", value: `₹${formatINR(profile.totalOrderValue)}` },
    { label: "Value rank", value: rankLabel },
    { label: "Co-signal", value: coSignalLabel },
  ];

  return {
    id: `HIGH_VALUE-${profile.id}`,
    type: "HIGH_VALUE",
    leadId: profile.id,
    leadType: "accounts",
    name: profile.name,
    priority: "HIGH", // always HIGH — already gated on a strong real co-signal
    score: profile.latestScore,
    classification: profile.latestClassification,
    productId: null,
    productName: null,
    evidence,
    rankSignal: profile.totalOrderValue,
    ruleBasedNarrative: `${profile.name} ranks ${rankLabel} by total order value (₹${formatINR(profile.totalOrderValue)}), and ${coSignalLabel.charAt(0).toLowerCase()}${coSignalLabel.slice(1)}.`,
    ruleBasedRecommendedAction: "Prioritize this high-value account personally.",
  };
}

/* -------------------------------------------------------------------------
 * REACTIVATION — real historical engagement (>=3 orders) plus real
 * dormancy past 90 days, reusing the exact dormancy convention already
 * established in intent-data.service.ts's
 * INACTIVE_SINGLE_ORDER_RECENCY_THRESHOLD_DAYS for consistency.
 * ---------------------------------------------------------------------- */

export const REACTIVATION_MIN_HISTORICAL_ORDERS = 3;
/** Matches intent-data.service.ts's INACTIVE_SINGLE_ORDER_RECENCY_THRESHOLD_DAYS for consistency across features. */
export const REACTIVATION_DORMANT_DAYS = 90;
/** Twice the dormancy threshold (~6 months) is treated as a stronger, more urgent signal. */
export const REACTIVATION_PRIORITY_HIGH_DAYS = 180;

export function detectReactivation(profile: AccountProfile, topValueInfo: TopValueInfo): OpportunityCandidate | null {
  if (profile.orderCount < REACTIVATION_MIN_HISTORICAL_ORDERS) return null;
  if (profile.recencyDays === null || profile.recencyDays <= REACTIVATION_DORMANT_DAYS) return null;

  const isTopValue = topValueInfo.accountIds.has(profile.id);
  const priority: DailyPriorityLevel = profile.recencyDays > REACTIVATION_PRIORITY_HIGH_DAYS || isTopValue ? "HIGH" : "MEDIUM";

  const evidence: OpportunityEvidenceItem[] = [
    { label: "Historical orders", value: `${profile.orderCount} orders` },
    { label: "Historical value", value: `₹${formatINR(profile.totalOrderValue)}` },
    { label: "Days since last order", value: `${profile.recencyDays} days` },
  ];

  return {
    id: `REACTIVATION-${profile.id}`,
    type: "REACTIVATION",
    leadId: profile.id,
    leadType: "accounts",
    name: profile.name,
    priority,
    score: profile.latestScore,
    classification: profile.latestClassification,
    productId: null,
    productName: null,
    evidence,
    rankSignal: profile.recencyDays,
    ruleBasedNarrative: `${profile.name} placed ${profile.orderCount} orders historically (₹${formatINR(profile.totalOrderValue)} total) but hasn't ordered in ${profile.recencyDays} days.`,
    ruleBasedRecommendedAction:
      priority === "HIGH" ? "Reach out promptly to win this dormant account back." : "Reach out to check in and re-engage this account.",
  };
}
