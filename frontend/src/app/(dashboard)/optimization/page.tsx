"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import type { OptimizationRecommendationStatus, OptimizationRecommendationType } from "@ai-sales/shared";
import { useGenerateRecommendations, useOptimizationRecommendations } from "@/hooks/use-optimization";
import { usePermissions } from "@/hooks/use-permissions";
import { RecommendationCard, TYPE_LABELS } from "@/components/optimization/recommendation-card";
import { Button } from "@/components/ui/button";
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
import { ApiError } from "@/lib/api-client";

const ALL = "all";
type StatusFilter = "all" | OptimizationRecommendationStatus;
type TypeFilter = "all" | OptimizationRecommendationType;

export default function OptimizationPage() {
  const { isAdmin, isManager } = usePermissions();
  const canManage = isAdmin || isManager;

  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("PENDING");
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>(ALL);

  const filters = {
    status: statusFilter === ALL ? undefined : statusFilter,
    type: typeFilter === ALL ? undefined : typeFilter,
  };

  const { data, isLoading, isError, error, refetch } = useOptimizationRecommendations(filters);
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

  const recommendations = data?.data ?? [];
  const hasFilters = statusFilter !== ALL || typeFilter !== ALL;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Optimization</h1>
          <p className="text-sm text-muted-foreground">
            Autonomously-identified optimization opportunities from your real data. Nothing happens
            until an admin or manager reviews and approves a recommendation — approving one can
            create a real follow-up or pause a real ad campaign.
          </p>
        </div>
        {canManage ? (
          <Button onClick={handleGenerate} isLoading={generate.isPending}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Generate recommendations
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="EXECUTED">Executed</SelectItem>
            <SelectItem value="EXECUTION_FAILED">Execution failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter(ALL);
              setTypeFilter(ALL);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load recommendations"
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : recommendations.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={hasFilters ? "No recommendations match your filters." : "No recommendations yet"}
          description={
            hasFilters
              ? "Try a different status or type filter."
              : canManage
                ? "Click \"Generate recommendations\" to scan your real data for optimization opportunities."
                : "An admin or manager hasn't generated any recommendations yet."
          }
        />
      ) : (
        <div className="space-y-3">
          {recommendations.map((recommendation) => (
            <RecommendationCard key={recommendation.id} recommendation={recommendation} />
          ))}
        </div>
      )}
    </div>
  );
}
