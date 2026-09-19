import type * as React from "react";
import type { OpportunitySummaryDTO } from "@ai-sales/shared";
import { OPPORTUNITY_TYPES } from "@ai-sales/shared";
import { AlertTriangle, RotateCcw, TrendingDown, ShoppingCart, Gem, RefreshCw, TrendingUp } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { formatNumber } from "@/lib/utils";

const TYPE_LABELS: Record<(typeof OPPORTUNITY_TYPES)[number], string> = {
  REORDER: "Reorder",
  AT_RISK: "At Risk",
  CROSS_SELL: "Cross-Sell",
  HIGH_VALUE: "High Value",
  REACTIVATION: "Reactivation",
  GROWING_ACCOUNT: "Growing",
};

const TYPE_ICONS: Record<(typeof OPPORTUNITY_TYPES)[number], React.ComponentType<{ className?: string }>> = {
  REORDER: RotateCcw,
  AT_RISK: TrendingDown,
  CROSS_SELL: ShoppingCart,
  HIGH_VALUE: Gem,
  REACTIVATION: RefreshCw,
  GROWING_ACCOUNT: TrendingUp,
};

/**
 * The 7-tile counts summary (High Priority + the 6 opportunity types), shared
 * verbatim by the dashboard's Opportunity Center card and the full
 * /opportunities page. `counts`/`highPriorityCount` always reflect the full
 * detected set — never affected by the narration limit or any filter — so
 * this always renders real totals, never fabricated numbers.
 */
export function OpportunitySummaryGrid({
  summary,
  isLoading,
}: {
  summary: OpportunitySummaryDTO | undefined;
  isLoading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
      <MetricCard
        label="High Priority"
        icon={AlertTriangle}
        isLoading={isLoading}
        metric={summary ? { status: "ok" as const, value: summary.highPriorityCount } : undefined}
        format={(v) => formatNumber(v)}
      />
      {OPPORTUNITY_TYPES.map((type) => (
        <MetricCard
          key={type}
          label={TYPE_LABELS[type]}
          icon={TYPE_ICONS[type]}
          isLoading={isLoading}
          metric={summary ? { status: "ok" as const, value: summary.counts[type] } : undefined}
          format={(v) => formatNumber(v)}
        />
      ))}
    </div>
  );
}
