"use client";

import { RefreshCw } from "lucide-react";
import { useSalesAgentToday, useRegenerateSalesAgentToday } from "@/hooks/use-sales-agent";
import { usePermissions } from "@/hooks/use-permissions";
import { PriorityCard } from "@/components/sales-agent/priority-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";

export default function SalesAgentPage() {
  const { data, isLoading, isError, error, refetch } = useSalesAgentToday();
  const { isAdmin, isManager } = usePermissions();
  const canRegenerate = isAdmin || isManager;
  const regenerate = useRegenerateSalesAgentToday();

  async function handleRegenerate() {
    try {
      await regenerate.mutateAsync();
      toast({ title: "Today's priorities regenerated" });
    } catch (err) {
      toast({
        title: "Couldn't regenerate priorities",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const priorities = data?.priorities ?? [];
  const hasRuleBased = priorities.some((p) => p.narrativeMethod === "RULE_BASED");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Sales Agent — Today&apos;s Priorities</h1>
          <p className="text-sm text-muted-foreground">
            {data
              ? `Generated ${new Date(data.generatedAt).toLocaleString()}`
              : "A deterministically-ranked, AI-narrated list of what to work on today."}
          </p>
        </div>
        {canRegenerate ? (
          <Button variant="outline" size="sm" onClick={handleRegenerate} isLoading={regenerate.isPending}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Regenerate
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Analyzing today&apos;s sales opportunities...</p>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load today's priorities"
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : !data || data.totalCandidates === 0 ? (
        <EmptyState
          title="No priority opportunities found today."
          description="Score your leads or log more sales to surface daily priorities."
        />
      ) : (
        <div className="space-y-4">
          {hasRuleBased ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              AI unavailable — showing rule-based priorities.
            </p>
          ) : null}
          <div className="space-y-3">
            {priorities.map((priority) => (
              <PriorityCard key={`${priority.leadType}-${priority.leadId}`} priority={priority} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
