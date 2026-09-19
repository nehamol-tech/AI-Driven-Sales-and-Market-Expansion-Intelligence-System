"use client";

import * as React from "react";
import Link from "next/link";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Minus,
  Store,
  Package,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Truck,
  MapPinned,
  Users,
  Megaphone,
  Sparkles,
} from "lucide-react";
import type { BusinessSignalDTO, RevenueBreakdownItem } from "@ai-sales/shared";
import { useDashboardOverview } from "@/hooks/use-dashboard";
import { useDashboardInsights } from "@/hooks/use-dashboard-insights";
import { useSalesTrend } from "@/hooks/use-sales-trend";
import { useRevenueAnalytics } from "@/hooks/use-revenue-analytics";
import { useDistributors } from "@/hooks/use-distributors";
import { useProducts } from "@/hooks/use-products";
import { useStates } from "@/hooks/use-states";
import { useOptimizationRecommendations, useGenerateRecommendations } from "@/hooks/use-optimization";
import { usePermissions } from "@/hooks/use-permissions";
import { MetricCard } from "@/components/dashboard/metric-card";
import { FmsDataCard } from "@/components/dashboard/fms-data-card";
import { RevenueTrendChart } from "@/components/revenue-analytics/revenue-trend-chart";
import { MethodBadge } from "@/components/leads/method-badge";
import { TYPE_LABELS } from "@/components/optimization/recommendation-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { cn, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";

const ALL = "__all__";

const CATEGORY_ICONS: Record<BusinessSignalDTO["category"], React.ComponentType<{ className?: string }>> = {
  PRODUCT: Package,
  DISTRIBUTOR: Truck,
  TERRITORY: MapPinned,
  ACCOUNT: Users,
  CAMPAIGN: Megaphone,
};

/**
 * Below this absolute value a % change reads as noise rather than a real
 * trend, so it renders as a neutral dash instead of an up/down arrow.
 */
const STEADY_THRESHOLD_PCT = 2;

function GrowthArrow({ pct }: { pct: number }) {
  if (Math.abs(pct) < STEADY_THRESHOLD_PCT) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="Steady" />;
  }
  return pct > 0 ? (
    <TrendingUp className="h-3.5 w-3.5 text-emerald-400" aria-label="Up" />
  ) : (
    <TrendingDown className="h-3.5 w-3.5 text-destructive" aria-label="Down" />
  );
}

/**
 * One real business signal (problem or opportunity). Problems stay a true
 * destructive red (a genuine concern); opportunities use the primary wine
 * accent (per the design system: the wine primary is reserved for important
 * KPIs/opportunity scores/AI recommendations, muted green is reserved for
 * genuine success — an "opportunity" is upside-but-not-yet-realized, not a
 * completed success, so it gets the wine-accent treatment, not green).
 * changePct is often null for
 * score-based signals (e.g. Market Expansion territories), in which case
 * only currentValue is shown, no arrow.
 */
function SignalCard({ signal, tone }: { signal: BusinessSignalDTO; tone: "problem" | "opportunity" }) {
  const Icon = CATEGORY_ICONS[signal.category];
  const toneColor = tone === "problem" ? "text-destructive" : "text-primary";
  const ArrowIcon = tone === "problem" ? TrendingDown : TrendingUp;

  const className = cn(
    "block h-full space-y-2 rounded-lg border border-border bg-card p-4 transition-shadow",
    signal.detailHref
      ? tone === "opportunity"
        ? "hover:border-primary/50 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.35),0_0_16px_-4px_hsl(var(--primary)/0.35)]"
        : "hover:border-destructive/40 hover:bg-accent/30"
      : ""
  );

  const content = (
    <>
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", toneColor)} />
        <div className="min-w-0">
          <p className="font-medium leading-tight">{signal.title}</p>
          <p className="text-sm text-muted-foreground">{signal.subtitle}</p>
        </div>
      </div>
      {signal.currentValue ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{signal.currentValue}</span>
          {signal.changePct !== null ? (
            <span className={cn("inline-flex items-center gap-1 text-xs font-medium", toneColor)}>
              <ArrowIcon className="h-3.5 w-3.5" />
              {Math.abs(signal.changePct).toFixed(1)}%
            </span>
          ) : null}
          {signal.previousValue ? (
            <span className="text-xs text-muted-foreground">from {signal.previousValue}</span>
          ) : null}
        </div>
      ) : null}
      {signal.evidence.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {signal.evidence.slice(0, 3).map((e) => (
            <li key={e.label}>
              {e.label}: <span className="font-medium text-foreground">{e.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm">{signal.recommendedAction}</p>
      {signal.detailHref ? <p className="text-xs font-medium text-primary">View details →</p> : null}
    </>
  );

  return signal.detailHref ? (
    <Link href={signal.detailHref} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** Ranked breakdown list with a growth arrow per item — reused for Top Products and Distributor Performance, both sourced from the same filtered useSalesTrend call. */
function RankedBreakdownList({
  title,
  items,
  emptyHint,
}: {
  title: string;
  items: RevenueBreakdownItem[];
  emptyHint: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li key={item.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-4 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
                  <span className="truncate text-sm font-medium" title={item.name}>
                    {item.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-right">
                  {typeof item.growthPct === "number" ? <GrowthArrow pct={item.growthPct} /> : null}
                  <span className="text-sm font-medium">{formatCurrency(item.totalValue)}</span>
                  <span className="text-xs text-muted-foreground">{formatNumber(item.orderCount)} orders</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { isAdmin, isManager } = usePermissions();
  const canManage = isAdmin || isManager;

  // Whole-company KPIs — never filter-driven.
  const overview = useDashboardOverview();
  const revenueAnalytics = useRevenueAnalytics();
  const activeDistributors = useDistributors({ status: "ACTIVE", pageSize: 1 });
  const activeProducts = useProducts({ isActive: true, pageSize: 1 });

  // Real, deterministically-detected business signals.
  const insights = useDashboardInsights();

  // Filter bar state — drives ONLY Sales Trend / Top Products / Distributor Performance.
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [stateId, setStateId] = React.useState(ALL);
  const [productId, setProductId] = React.useState(ALL);
  const [distributorId, setDistributorId] = React.useState(ALL);

  const { data: states } = useStates();
  const { data: filterProducts } = useProducts({ pageSize: 100 });
  const { data: filterDistributors } = useDistributors({ pageSize: 100 });

  const hasFilters = Boolean(
    dateFrom || dateTo || stateId !== ALL || productId !== ALL || distributorId !== ALL
  );

  const salesTrend = useSalesTrend({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    stateId: stateId === ALL ? undefined : stateId,
    productId: productId === ALL ? undefined : productId,
    distributorId: distributorId === ALL ? undefined : distributorId,
  });

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setStateId(ALL);
    setProductId(ALL);
    setDistributorId(ALL);
  }

  // AI Recommendations — reuses the existing Phase 9 hook/data unchanged.
  const pendingRecs = useOptimizationRecommendations({ status: "PENDING" });
  const generate = useGenerateRecommendations();

  async function handleGenerate() {
    try {
      const result = await generate.mutateAsync();
      const createdCount = result.created.length;
      const skipped = result.skippedDuplicates;
      const parts = [`${createdCount} new recommendation${createdCount === 1 ? "" : "s"} found`];
      if (skipped > 0) parts.push(`${skipped} already pending`);
      toast({ title: `${parts[0]}${parts[1] ? ` (${parts[1]})` : ""}` });
    } catch (err) {
      toast({
        title: "Couldn't generate recommendations",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const activeDistributorsMetric = activeDistributors.data
    ? ({ status: "ok" as const, value: activeDistributors.data.pagination.total })
    : undefined;
  const activeProductsMetric = activeProducts.data
    ? ({ status: "ok" as const, value: activeProducts.data.pagination.total })
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          AI Sales Expansion Engine
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Business Growth &amp; Action Center</h1>
      </div>

      {/* KPI row — always whole-company, never filter-driven */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Total sales"
          icon={DollarSign}
          isLoading={overview.isLoading}
          metric={overview.data?.totalSales}
          format={(v) => formatCurrency(v)}
          hint="Log sales records to see revenue totals."
        />
        <MetricCard
          label="Sales growth"
          icon={TrendingUp}
          isLoading={revenueAnalytics.isLoading}
          metric={revenueAnalytics.data?.growthRatePercent}
          format={(v) => (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                v >= 0 ? "text-emerald-400" : "text-destructive"
              )}
            >
              {v >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {formatPercent(v)}
            </span>
          )}
          hint="Needs at least two months of real sales history to compute."
        />
        <MetricCard
          label="Active distributors"
          icon={Store}
          isLoading={activeDistributors.isLoading}
          metric={activeDistributorsMetric}
          format={(v) => formatNumber(v)}
          hint="Add distributors to see coverage."
        />
        <MetricCard
          label="Orders"
          icon={ShoppingCart}
          isLoading={overview.isLoading}
          metric={overview.data?.totalOrders}
          format={(v) => formatNumber(v)}
          hint="Log sales records to see order counts."
        />
        <MetricCard
          label="Products"
          icon={Package}
          isLoading={activeProducts.isLoading}
          metric={activeProductsMetric}
          format={(v) => formatNumber(v)}
          hint="Add active products to your catalog."
        />
      </div>

      {/* Problems / Opportunities */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Problems to Fix
            </CardTitle>
            <CardDescription>Real issues detected in your data that need attention.</CardDescription>
          </CardHeader>
          <CardContent>
            {insights.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : insights.isError ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {insights.error instanceof ApiError ? insights.error.message : "Unable to load problems."}
                </p>
                <Button variant="outline" size="sm" onClick={() => insights.refetch()}>
                  Try again
                </Button>
              </div>
            ) : !insights.data || insights.data.problems.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="No problems detected right now"
                description="Your business signals look healthy based on the real data on file."
              />
            ) : (
              <div className="space-y-3">
                {insights.data.problems.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} tone="problem" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-primary" />
              Growth Opportunities
            </CardTitle>
            <CardDescription>Where the data points to real upside.</CardDescription>
          </CardHeader>
          <CardContent>
            {insights.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : insights.isError ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {insights.error instanceof ApiError ? insights.error.message : "Unable to load opportunities."}
                </p>
                <Button variant="outline" size="sm" onClick={() => insights.refetch()}>
                  Try again
                </Button>
              </div>
            ) : !insights.data || insights.data.opportunities.length === 0 ? (
              <EmptyState
                icon={Lightbulb}
                title="No standout opportunities right now"
                description="Check back as more sales data comes in."
              />
            ) : (
              <div className="space-y-3">
                {insights.data.opportunities.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} tone="opportunity" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filter bar — drives Sales Trend / Top Products / Distributor Performance only */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="dashDateFrom" className="text-xs">From</Label>
          <Input
            id="dashDateFrom"
            type="date"
            className="w-40"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dashDateTo" className="text-xs">To</Label>
          <Input
            id="dashDateTo"
            type="date"
            className="w-40"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">State</Label>
          <Select value={stateId} onValueChange={setStateId}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              {states?.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Product</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All products</SelectItem>
              {filterProducts?.data.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Distributor</Label>
          <Select value={distributorId} onValueChange={setDistributorId}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All distributors</SelectItem>
              {filterDistributors?.data.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {/* Sales Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📊 Sales Trend</CardTitle>
          <CardDescription>Real monthly revenue for the selected filters.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {salesTrend.isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : salesTrend.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {salesTrend.error instanceof ApiError ? salesTrend.error.message : "Unable to load the sales trend."}
              </p>
              <Button variant="outline" size="sm" onClick={() => salesTrend.refetch()}>
                Try again
              </Button>
            </div>
          ) : !salesTrend.data || salesTrend.data.series.length === 0 ? (
            <EmptyState
              title={hasFilters ? "No sales records match these filters" : "No sales history yet"}
              description={
                hasFilters
                  ? "Try widening the date range or clearing a filter."
                  : "Log sales records to start building a sales trend."
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Total (filtered)</p>
                  <p className="text-lg font-semibold">{formatCurrency(salesTrend.data.totalForFilteredRange)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Orders (filtered)</p>
                  <p className="text-lg font-semibold">{formatNumber(salesTrend.data.orderCountForFilteredRange)}</p>
                </div>
              </div>
              <RevenueTrendChart series={salesTrend.data.series} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Top Products / Distributor Performance — both from the same filtered useSalesTrend call */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {salesTrend.isLoading ? (
          <>
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </>
        ) : (
          <>
            <RankedBreakdownList
              title="🏆 Top Products"
              items={salesTrend.data?.topProducts ?? []}
              emptyHint="No product sales in this range yet."
            />
            <RankedBreakdownList
              title="🏪 Distributor Performance"
              items={salesTrend.data?.distributorPerformance ?? []}
              emptyHint="No distributor sales in this range yet."
            />
          </>
        )}
      </div>

      {/* AI Recommendations — reuses the existing Phase 9 hook/data unchanged */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">🤖 AI Recommendations</CardTitle>
            <CardDescription>What should we do next, based on real signals?</CardDescription>
          </div>
          {canManage ? (
            <Button size="sm" onClick={handleGenerate} isLoading={generate.isPending}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Generate recommendations
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {pendingRecs.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : pendingRecs.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {pendingRecs.error instanceof ApiError ? pendingRecs.error.message : "Unable to load recommendations."}
              </p>
              <Button variant="outline" size="sm" onClick={() => pendingRecs.refetch()}>
                Try again
              </Button>
            </div>
          ) : !pendingRecs.data || pendingRecs.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Insufficient data for a reliable recommendation.</p>
          ) : (
            <ol className="space-y-3">
              {pendingRecs.data.data.map((rec, index) => (
                <li
                  key={rec.id}
                  className="flex gap-3 rounded-lg border border-border bg-card p-4 transition-shadow hover:border-primary/40 hover:shadow-[0_0_16px_-6px_hsl(var(--primary)/0.45)]"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {TYPE_LABELS[rec.type]} — {rec.targetLabel}
                      </p>
                      <MethodBadge method={rec.narrativeMethod} />
                    </div>
                    {rec.narrative ? <p className="text-sm text-muted-foreground">{rec.narrative}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* FMS Data — read-only preview from the connected FMS Google Sheet, fetched via our own backend */}
      <FmsDataCard />
    </div>
  );
}
