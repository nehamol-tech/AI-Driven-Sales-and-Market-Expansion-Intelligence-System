import { Flame, TrendingUp, Sprout, HelpCircle } from "lucide-react";
import type { MarketExpansionSummaryDTO } from "@ai-sales/shared";
import { MetricCard } from "@/components/dashboard/metric-card";
import { formatNumber } from "@/lib/utils";

/**
 * The 4-tile classification-count grid, shared by the dashboard card and the
 * full /market-expansion page. High/Medium/Emerging counts come from
 * `markets` (the narrated, ranked list) — but `markets` never includes
 * INSUFFICIENT_DATA states at all (nothing to rank or narrate), so that
 * tile is computed as `totalStatesAnalyzed - totalStatesWithData` instead,
 * which is the only honest source for it.
 */
export function MarketSummaryGrid({
  summary,
  isLoading,
}: {
  summary: MarketExpansionSummaryDTO | undefined;
  isLoading: boolean;
}) {
  const markets = summary?.markets ?? [];
  const highCount = markets.filter((m) => m.classification === "HIGH_OPPORTUNITY").length;
  const mediumCount = markets.filter((m) => m.classification === "MEDIUM_OPPORTUNITY").length;
  const emergingCount = markets.filter((m) => m.classification === "EMERGING").length;
  const insufficientCount = summary
    ? Math.max(0, summary.totalStatesAnalyzed - summary.totalStatesWithData)
    : 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <MetricCard
        label="High Opportunity"
        icon={Flame}
        isLoading={isLoading}
        metric={summary ? { status: "ok" as const, value: highCount } : undefined}
        format={(v) => formatNumber(v)}
      />
      <MetricCard
        label="Medium Opportunity"
        icon={TrendingUp}
        isLoading={isLoading}
        metric={summary ? { status: "ok" as const, value: mediumCount } : undefined}
        format={(v) => formatNumber(v)}
      />
      <MetricCard
        label="Emerging"
        icon={Sprout}
        isLoading={isLoading}
        metric={summary ? { status: "ok" as const, value: emergingCount } : undefined}
        format={(v) => formatNumber(v)}
      />
      <MetricCard
        label="Insufficient Data"
        icon={HelpCircle}
        isLoading={isLoading}
        metric={summary ? { status: "ok" as const, value: insufficientCount } : undefined}
        format={(v) => formatNumber(v)}
      />
    </div>
  );
}
