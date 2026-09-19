"use client";

import * as React from "react";
import { RefreshCw, Search } from "lucide-react";
import type { MarketOpportunityClassification, MarketSummaryDTO } from "@ai-sales/shared";
import { useMarketExpansion, useRegenerateMarketExpansion } from "@/hooks/use-market-expansion";
import { usePermissions } from "@/hooks/use-permissions";
import { MarketSummaryGrid } from "@/components/market-expansion/market-summary-grid";
import { MarketCard } from "@/components/market-expansion/market-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api-client";

const ALL = "all";
type ClassificationFilter = "all" | MarketOpportunityClassification;
type SortOption = "score" | "salesValue" | "accounts" | "orders";

const CLASSIFICATION_FILTER_LABELS: Record<Exclude<ClassificationFilter, "all">, string> = {
  HIGH_OPPORTUNITY: "High Opportunity",
  MEDIUM_OPPORTUNITY: "Medium Opportunity",
  EMERGING: "Emerging",
  // Not shown in the filter's option list (no INSUFFICIENT_DATA states ever
  // appear in `markets`), kept only so the Record type stays exhaustive.
  INSUFFICIENT_DATA: "Insufficient Data",
};

const SORT_LABELS: Record<SortOption, string> = {
  score: "Score",
  salesValue: "Sales value",
  accounts: "Accounts",
  orders: "Orders",
};

function sortMarkets(markets: MarketSummaryDTO[], sort: SortOption): MarketSummaryDTO[] {
  const copy = [...markets];
  switch (sort) {
    case "salesValue":
      return copy.sort((a, b) => Number(b.totalSalesValue) - Number(a.totalSalesValue));
    case "accounts":
      return copy.sort((a, b) => b.accountCount - a.accountCount);
    case "orders":
      return copy.sort((a, b) => b.orderCount - a.orderCount);
    case "score":
    default:
      // Backend already ranks by score desc; re-applying it here keeps the
      // behavior explicit and correct if the user switches back to it after
      // picking another sort.
      return copy.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }
}

export default function MarketExpansionPage() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [classificationFilter, setClassificationFilter] = React.useState<ClassificationFilter>(ALL);
  const [sort, setSort] = React.useState<SortOption>("score");
  const { isAdmin, isManager } = usePermissions();
  const canRegenerate = isAdmin || isManager;

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useMarketExpansion();
  const regenerate = useRegenerateMarketExpansion();

  async function handleRegenerate() {
    try {
      await regenerate.mutateAsync();
      toast({ title: "Market expansion data regenerated" });
    } catch (err) {
      toast({
        title: "Couldn't regenerate market expansion data",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const allMarkets = data?.markets ?? [];

  const filteredMarkets = allMarkets.filter((market) => {
    if (classificationFilter !== ALL && market.classification !== classificationFilter) return false;
    if (debouncedSearch && !market.stateName.toLowerCase().includes(debouncedSearch.toLowerCase())) {
      return false;
    }
    return true;
  });

  const sortedMarkets = sortMarkets(filteredMarkets, sort);
  const hasFilters = Boolean(debouncedSearch) || classificationFilter !== ALL;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">🌎 Market Expansion</h1>
          <p className="text-sm text-muted-foreground">
            Identify geographic markets worth investigating using your existing sales intelligence.
          </p>
        </div>
        {canRegenerate ? (
          <Button variant="outline" size="sm" onClick={handleRegenerate} isLoading={regenerate.isPending}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Regenerate
          </Button>
        ) : null}
      </div>

      <MarketSummaryGrid summary={data} isLoading={isLoading} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search states..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={classificationFilter}
          onValueChange={(v) => setClassificationFilter(v as ClassificationFilter)}
        >
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All classifications</SelectItem>
            <SelectItem value="HIGH_OPPORTUNITY">{CLASSIFICATION_FILTER_LABELS.HIGH_OPPORTUNITY}</SelectItem>
            <SelectItem value="MEDIUM_OPPORTUNITY">{CLASSIFICATION_FILTER_LABELS.MEDIUM_OPPORTUNITY}</SelectItem>
            <SelectItem value="EMERGING">{CLASSIFICATION_FILTER_LABELS.EMERGING}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
              <SelectItem key={option} value={option}>
                Sort by {SORT_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Analyzing market signals...</p>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Unable to load market expansion data."
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : !data || data.totalStatesWithData === 0 ? (
        <EmptyState
          title="No market signals available yet."
          description="Add more sales history to begin identifying geographic expansion opportunities."
        />
      ) : sortedMarkets.length === 0 ? (
        <EmptyState
          title="No markets match your search/filter"
          description="Try a different search term or classification filter."
        />
      ) : (
        <div className="space-y-3">
          {sortedMarkets.map((market) => (
            <MarketCard key={market.stateId} market={market} />
          ))}
        </div>
      )}

      {!hasFilters && data && data.totalStatesAnalyzed > 0 ? (
        <p className="text-xs text-muted-foreground">
          {data.totalStatesWithData} of {data.totalStatesAnalyzed} states have real internal data on
          file; the rest are not shown here (insufficient data).
        </p>
      ) : null}
    </div>
  );
}
