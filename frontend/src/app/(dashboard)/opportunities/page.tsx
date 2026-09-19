"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import type { DailyPriorityLevel, OpportunityType } from "@ai-sales/shared";
import { OPPORTUNITY_TYPES } from "@ai-sales/shared";
import { useOpportunities, useRegenerateOpportunities } from "@/hooks/use-opportunities";
import { usePermissions } from "@/hooks/use-permissions";
import { OpportunitySummaryGrid } from "@/components/opportunities/opportunity-summary-grid";
import { OpportunityCard } from "@/components/opportunities/opportunity-card";
import { Button } from "@/components/ui/button";
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
type TypeFilter = "all" | OpportunityType;
type PriorityFilter = "all" | DailyPriorityLevel;

const TYPE_FILTER_LABELS: Record<OpportunityType, string> = {
  REORDER: "Reorder",
  AT_RISK: "At Risk",
  CROSS_SELL: "Cross-Sell",
  HIGH_VALUE: "High Value",
  REACTIVATION: "Reactivation",
  GROWING_ACCOUNT: "Growing",
};

export default function OpportunitiesPage() {
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>(ALL);
  const [priorityFilter, setPriorityFilter] = React.useState<PriorityFilter>(ALL);
  const { isAdmin, isManager } = usePermissions();
  const canRegenerate = isAdmin || isManager;

  const filters = {
    type: typeFilter === ALL ? undefined : typeFilter,
    priority: priorityFilter === ALL ? undefined : priorityFilter,
  };

  const { data, isLoading, isError, error, refetch } = useOpportunities(filters);
  const regenerate = useRegenerateOpportunities(filters);

  async function handleRegenerate() {
    try {
      await regenerate.mutateAsync();
      toast({ title: "Opportunities regenerated" });
    } catch (err) {
      toast({
        title: "Couldn't regenerate opportunities",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const opportunities = data?.opportunities ?? [];
  const hasRuleBased = opportunities.some((o) => o.narrativeMethod === "RULE_BASED");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">🤖 Opportunity Center</h1>
          <p className="text-sm text-muted-foreground">
            Sales opportunities detected from your real customer and product data.
          </p>
        </div>
        {canRegenerate ? (
          <Button variant="outline" size="sm" onClick={handleRegenerate} isLoading={regenerate.isPending}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Regenerate
          </Button>
        ) : null}
      </div>

      <OpportunitySummaryGrid summary={data} isLoading={isLoading} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {OPPORTUNITY_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {TYPE_FILTER_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as PriorityFilter)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priorities</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Finding sales opportunities...</p>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Unable to load opportunities right now."
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : !data || data.totalOpportunities === 0 ? (
        <EmptyState
          title="No new opportunities detected."
          description="The system needs enough real sales history to identify reliable opportunities."
        />
      ) : opportunities.length === 0 ? (
        <EmptyState
          title="No opportunities match your filters."
          description="Try a different type or priority filter."
        />
      ) : (
        <div className="space-y-4">
          {hasRuleBased ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              AI unavailable — showing rule-based insights.
            </p>
          ) : null}
          <div className="space-y-3">
            {opportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
