import type { OpportunityCategory } from "@ai-sales/shared";
import { OPPORTUNITY_CATEGORIES } from "@ai-sales/shared";

/** Card labels — the same wording the Opportunity Center cards already use. */
export const OPPORTUNITY_CATEGORY_LABELS: Record<OpportunityCategory, string> = {
  HIGH_PRIORITY: "High Priority",
  REORDER: "Reorder",
  AT_RISK: "At Risk",
  CROSS_SELL: "Cross-Sell",
  HIGH_VALUE: "High Value",
  REACTIVATION: "Reactivation",
  GROWING_ACCOUNT: "Growing",
};

/** URL segment for each card's detail page: /opportunities/<slug>. */
const SLUGS: Record<OpportunityCategory, string> = {
  HIGH_PRIORITY: "high-priority",
  REORDER: "reorder",
  AT_RISK: "at-risk",
  CROSS_SELL: "cross-sell",
  HIGH_VALUE: "high-value",
  REACTIVATION: "reactivation",
  GROWING_ACCOUNT: "growing",
};

export function opportunityCategoryHref(category: OpportunityCategory): string {
  return `/opportunities/${SLUGS[category]}`;
}

export function categoryFromSlug(slug: string): OpportunityCategory | null {
  return OPPORTUNITY_CATEGORIES.find((c) => SLUGS[c] === slug) ?? null;
}
