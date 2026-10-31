import type * as React from "react";
import Link from "next/link";
import type { OpportunityCategory, OpportunitySummaryDTO } from "@ai-sales/shared";
import { OPPORTUNITY_CATEGORIES } from "@ai-sales/shared";
import { AlertTriangle, RotateCcw, TrendingDown, ShoppingCart, Gem, RefreshCw, TrendingUp } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { OPPORTUNITY_CATEGORY_LABELS } from "@/components/opportunities/opportunity-categories";
import { formatNumber } from "@/lib/utils";

const CATEGORY_ICONS: Record<OpportunityCategory, React.ComponentType<{ className?: string }>> = {
  HIGH_PRIORITY: AlertTriangle,
  REORDER: RotateCcw,
  AT_RISK: TrendingDown,
  CROSS_SELL: ShoppingCart,
  HIGH_VALUE: Gem,
  REACTIVATION: RefreshCw,
  GROWING_ACCOUNT: TrendingUp,
};

function countFor(summary: OpportunitySummaryDTO, category: OpportunityCategory): number {
  return category === "HIGH_PRIORITY" ? summary.highPriorityCount : summary.counts[category];
}

/**
 * The 7-tile counts summary (High Priority + the 6 opportunity types).
 * `counts`/`highPriorityCount` always reflect the full detected set — never
 * affected by the narration limit or any filter — so this always renders
 * real totals, never fabricated numbers. Pass `hrefFor` to make each tile
 * open its detail list; without it the tiles render as plain cards.
 */
export function OpportunitySummaryGrid({
  summary,
  isLoading,
  hrefFor,
}: {
  summary: OpportunitySummaryDTO | undefined;
  isLoading: boolean;
  hrefFor?: (category: OpportunityCategory) => string;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
      {OPPORTUNITY_CATEGORIES.map((category) => {
        const card = (
          <MetricCard
            label={OPPORTUNITY_CATEGORY_LABELS[category]}
            icon={CATEGORY_ICONS[category]}
            isLoading={isLoading}
            metric={summary ? { status: "ok" as const, value: countFor(summary, category) } : undefined}
            format={(v) => formatNumber(v)}
            className={hrefFor ? "h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/40" : undefined}
          />
        );
        if (!hrefFor) return <div key={category}>{card}</div>;
        return (
          <Link
            key={category}
            href={hrefFor(category)}
            aria-label={`View ${OPPORTUNITY_CATEGORY_LABELS[category]} opportunities`}
            className="group block cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {card}
          </Link>
        );
      })}
    </div>
  );
}
