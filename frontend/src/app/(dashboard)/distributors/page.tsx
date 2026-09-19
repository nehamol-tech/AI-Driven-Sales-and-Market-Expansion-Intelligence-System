"use client";

import * as React from "react";
import { Plus, RefreshCw, Warehouse } from "lucide-react";
import type { DistributorDTO } from "@ai-sales/shared";
import {
  useDistributors,
  useDistributorExpansion,
  useRegenerateDistributorExpansion,
} from "@/hooks/use-distributors";
import { usePermissions } from "@/hooks/use-permissions";
import { DistributorDialog } from "@/components/distributors/distributor-dialog";
import { DistributorPanel } from "@/components/distributors/distributor-panel";
import { ClassificationLabel } from "@/components/market-expansion/classification-label";
import { MethodBadge } from "@/components/leads/method-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";
import { formatCurrency, formatNumber } from "@/lib/utils";

export default function DistributorsPage() {
  const { isAdmin, isManager } = usePermissions();
  const canRegenerate = isAdmin || isManager;

  const {
    data: distributorsPage,
    isLoading: isDistributorsLoading,
    isError: isDistributorsError,
    refetch: refetchDistributors,
  } = useDistributors();
  const {
    data: expansion,
    isLoading: isExpansionLoading,
    isError: isExpansionError,
    refetch: refetchExpansion,
  } = useDistributorExpansion();
  const regenerate = useRegenerateDistributorExpansion();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingDistributor, setEditingDistributor] = React.useState<DistributorDTO | null>(null);

  async function handleRegenerate() {
    try {
      await regenerate.mutateAsync();
      toast({ title: "Expansion analytics regenerated" });
    } catch (err) {
      toast({
        title: "Couldn't regenerate expansion analytics",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  function openNewDistributor() {
    setEditingDistributor(null);
    setDialogOpen(true);
  }

  function openEditDistributor(distributor: DistributorDTO) {
    setEditingDistributor(distributor);
    setDialogOpen(true);
  }

  const distributors = distributorsPage?.data ?? [];
  const recommendations = expansion?.recommendations ?? [];
  const performance = expansion?.performance ?? [];
  const insightHeading = expansion?.narrativeMethod === "RULE_BASED" ? "Rule-based insight" : "AI insight";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Distributors</h1>
          <p className="text-sm text-muted-foreground">
            Manage distributors and dealers, and see which real markets have demand but no coverage yet.
          </p>
        </div>
        {canRegenerate ? (
          <Button variant="outline" size="sm" onClick={handleRegenerate} isLoading={regenerate.isPending}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Regenerate
          </Button>
        ) : null}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Distributors &amp; dealers</h2>
          <Button size="sm" onClick={openNewDistributor}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New distributor
          </Button>
        </div>
        {isDistributorsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : isDistributorsError ? (
          <EmptyState
            title="Unable to load distributors."
            action={<Button onClick={() => refetchDistributors()}>Try again</Button>}
          />
        ) : distributors.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            title="No distributors yet"
            description="Add your first distributor or dealer to start tracking territory coverage."
            action={<Button onClick={openNewDistributor}>New distributor</Button>}
          />
        ) : (
          <div className="space-y-3">
            {distributors.map((distributor) => (
              <DistributorPanel key={distributor.id} distributor={distributor} onEdit={openEditDistributor} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Expansion recommendations</h2>
        <p className="text-sm text-muted-foreground">
          Real states with genuine internal demand signal and zero distributor coverage today.
        </p>
        {isExpansionLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isExpansionError ? (
          <EmptyState
            title="Unable to load expansion recommendations."
            action={<Button onClick={() => refetchExpansion()}>Try again</Button>}
          />
        ) : recommendations.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            No uncovered opportunity states right now.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {recommendations.map((rec) => (
              <li key={rec.stateId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-medium">{rec.stateName}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Score: {rec.opportunityScore}</span>
                  <ClassificationLabel classification={rec.opportunityClassification} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Distributor performance</h2>
        {isExpansionLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isExpansionError ? (
          <EmptyState
            title="Unable to load distributor performance."
            action={<Button onClick={() => refetchExpansion()}>Try again</Button>}
          />
        ) : performance.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            No distributor performance yet — add a distributor and link sales records to it.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {performance.map((perf) => (
              <li key={perf.distributorId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{perf.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {perf.type === "DISTRIBUTOR" ? "Distributor" : "Dealer"}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>{formatCurrency(perf.totalRevenue)}</span>
                  <span>{formatNumber(perf.orderCount)} order{perf.orderCount === 1 ? "" : "s"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Expansion narrative</CardTitle>
          {!isExpansionLoading && expansion ? <MethodBadge method={expansion.narrativeMethod} /> : null}
        </CardHeader>
        <CardContent>
          {isExpansionLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : isExpansionError ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Unable to load the expansion narrative.</p>
              <Button variant="outline" size="sm" onClick={() => refetchExpansion()}>
                Try again
              </Button>
            </div>
          ) : expansion?.narrative ? (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <h4 className="mb-1 text-sm font-semibold">{insightHeading}</h4>
              <p className="text-sm">{expansion.narrative}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough data yet — add a distributor or generate expansion recommendations to see a narrative here.
            </p>
          )}
        </CardContent>
      </Card>

      <DistributorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        distributor={editingDistributor}
      />
    </div>
  );
}
