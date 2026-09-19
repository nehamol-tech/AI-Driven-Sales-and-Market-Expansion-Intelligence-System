"use client";

import { CalendarRange, DollarSign, RefreshCw, TrendingUp } from "lucide-react";
import { useRegenerateRevenueAnalytics, useRevenueAnalytics } from "@/hooks/use-revenue-analytics";
import { usePermissions } from "@/hooks/use-permissions";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RevenueTrendChart } from "@/components/revenue-analytics/revenue-trend-chart";
import { BreakdownList } from "@/components/revenue-analytics/breakdown-list";
import { PipelineFunnel } from "@/components/revenue-analytics/pipeline-funnel";
import { MethodBadge } from "@/components/leads/method-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";

export default function RevenueAnalyticsPage() {
  const { data, isLoading, isError, error, refetch } = useRevenueAnalytics();
  const regenerate = useRegenerateRevenueAnalytics();
  const { isAdmin, isManager } = usePermissions();
  const canRegenerate = isAdmin || isManager;

  async function handleRegenerate() {
    try {
      await regenerate.mutateAsync();
      toast({ title: "Revenue analytics regenerated" });
    } catch (err) {
      toast({
        title: "Couldn't regenerate revenue analytics",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const insightHeading = data?.narrativeMethod === "RULE_BASED" ? "Rule-based insight" : "AI insight";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Revenue Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Real revenue trends, a short-term forecast, and breakdowns from your sales history.
          </p>
        </div>
        {canRegenerate ? (
          <Button variant="outline" size="sm" onClick={handleRegenerate} isLoading={regenerate.isPending}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Regenerate
          </Button>
        ) : null}
      </div>

      {isError ? (
        <EmptyState
          title="Unable to load revenue analytics."
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              label="Total revenue"
              icon={DollarSign}
              isLoading={isLoading}
              metric={data ? { status: "ok" as const, value: data.totalRevenueAllTime } : undefined}
              format={(v) => formatCurrency(v)}
              hint="Log sales records to see total revenue."
            />
            <MetricCard
              label="Months of history"
              icon={CalendarRange}
              isLoading={isLoading}
              metric={data ? { status: "ok" as const, value: data.monthsOfHistory } : undefined}
              format={(v) => formatNumber(v)}
              hint="Log sales records across multiple months."
            />
            <MetricCard
              label="Growth rate"
              icon={TrendingUp}
              isLoading={isLoading}
              metric={data?.growthRatePercent}
              format={(v) => formatPercent(v)}
              hint="Needs at least two months of real sales history to compute."
            />
          </div>

          {!isLoading && data && data.monthsOfHistory === 0 ? (
            <EmptyState
              title="No real sales history yet"
              description="Log sales records over time to unlock revenue trends, a forecast, and breakdowns. The pipeline funnel below is independent of sales history and reflects your prospects today."
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue trend</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : (
                <RevenueTrendChart series={data?.series ?? []} />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {isLoading ? (
              <>
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-48 w-full" />
              </>
            ) : (
              <>
                <BreakdownList
                  title="Top states"
                  items={data?.byState ?? []}
                  emptyHint="No state-level revenue data yet."
                />
                <BreakdownList
                  title="Top industries"
                  items={data?.byIndustry ?? []}
                  emptyHint="No industry-level revenue data yet."
                />
                <BreakdownList
                  title="Top products"
                  items={data?.byProduct ?? []}
                  emptyHint="No product-level revenue data yet."
                />
                <BreakdownList
                  title="Top salespeople"
                  items={data?.bySalesperson ?? []}
                  emptyHint="No salesperson-level revenue data yet."
                />
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline funnel</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-56 w-full" />
              ) : data && data.pipelineFunnel.length > 0 ? (
                <PipelineFunnel stages={data.pipelineFunnel} />
              ) : (
                <p className="text-sm text-muted-foreground">No prospects on file yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Analytics narrative</CardTitle>
              {!isLoading && data ? <MethodBadge method={data.narrativeMethod} /> : null}
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : data?.narrative ? (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <h4 className="mb-1 text-sm font-semibold">{insightHeading}</h4>
                  <p className="text-sm">{data.narrative}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not enough data yet to generate an analytics narrative.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
