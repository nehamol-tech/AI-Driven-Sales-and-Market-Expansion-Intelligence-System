"use client";

import * as React from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { AdCampaignDTO } from "@ai-sales/shared";
import {
  useAdCampaigns,
  useAdConnections,
  useAdvertisingAnalytics,
  useRegenerateAdvertisingAnalytics,
} from "@/hooks/use-advertising";
import { usePermissions } from "@/hooks/use-permissions";
import { ConnectionCard } from "@/components/advertising/connection-card";
import { CampaignDialog } from "@/components/advertising/campaign-dialog";
import { CampaignPanel } from "@/components/advertising/campaign-panel";
import { MethodBadge } from "@/components/leads/method-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";

export default function AdvertisingPage() {
  const { isAdmin, isManager } = usePermissions();
  const canRegenerate = isAdmin || isManager;

  const {
    data: connections,
    isLoading: isConnectionsLoading,
    isError: isConnectionsError,
    refetch: refetchConnections,
  } = useAdConnections();
  const {
    data: campaignsPage,
    isLoading: isCampaignsLoading,
    isError: isCampaignsError,
    refetch: refetchCampaigns,
  } = useAdCampaigns();
  const {
    data: analytics,
    isLoading: isAnalyticsLoading,
    isError: isAnalyticsError,
    refetch: refetchAnalytics,
  } = useAdvertisingAnalytics();
  const regenerate = useRegenerateAdvertisingAnalytics();

  const [campaignDialogOpen, setCampaignDialogOpen] = React.useState(false);
  const [editingCampaign, setEditingCampaign] = React.useState<AdCampaignDTO | null>(null);

  async function handleRegenerate() {
    try {
      await regenerate.mutateAsync();
      toast({ title: "Advertising analytics regenerated" });
    } catch (err) {
      toast({
        title: "Couldn't regenerate advertising analytics",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  function openNewCampaign() {
    setEditingCampaign(null);
    setCampaignDialogOpen(true);
  }

  function openEditCampaign(campaign: AdCampaignDTO) {
    setEditingCampaign(campaign);
    setCampaignDialogOpen(true);
  }

  const campaigns = campaignsPage?.data ?? [];
  const analyticsByCampaignId = new Map((analytics?.campaigns ?? []).map((c) => [c.campaignId, c]));
  const insightHeading = analytics?.narrativeMethod === "RULE_BASED" ? "Rule-based insight" : "AI insight";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Advertising</h1>
          <p className="text-sm text-muted-foreground">
            Connect ad platforms, log campaigns and spend, and see what&apos;s actually driving leads and revenue.
          </p>
        </div>
        {canRegenerate ? (
          <Button variant="outline" size="sm" onClick={handleRegenerate} isLoading={regenerate.isPending}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Regenerate analytics
          </Button>
        ) : null}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Connections</h2>
        {isConnectionsLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : isConnectionsError ? (
          <EmptyState
            title="Unable to load connections."
            action={<Button onClick={() => refetchConnections()}>Try again</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(connections ?? []).map((connection) => (
              <ConnectionCard key={connection.platform} connection={connection} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Campaigns</h2>
          <Button size="sm" onClick={openNewCampaign}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New campaign
          </Button>
        </div>
        {isCampaignsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : isCampaignsError ? (
          <EmptyState
            title="Unable to load campaigns."
            action={<Button onClick={() => refetchCampaigns()}>Try again</Button>}
          />
        ) : campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            description="Log a manual campaign, or connect and sync a real ad platform above once it's configured."
            action={<Button onClick={openNewCampaign}>New campaign</Button>}
          />
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <CampaignPanel
                key={campaign.id}
                campaign={campaign}
                analytics={analyticsByCampaignId.get(campaign.id)}
                onEdit={openEditCampaign}
              />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Analytics narrative</CardTitle>
          {!isAnalyticsLoading && analytics ? <MethodBadge method={analytics.narrativeMethod} /> : null}
        </CardHeader>
        <CardContent>
          {isAnalyticsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : isAnalyticsError ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Unable to load the advertising narrative.</p>
              <Button variant="outline" size="sm" onClick={() => refetchAnalytics()}>
                Try again
              </Button>
            </div>
          ) : analytics?.narrative ? (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <h4 className="mb-1 text-sm font-semibold">{insightHeading}</h4>
              <p className="text-sm">{analytics.narrative}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough data yet to generate an advertising narrative — log at least one campaign to get started.
            </p>
          )}
        </CardContent>
      </Card>

      <CampaignDialog
        open={campaignDialogOpen}
        onOpenChange={setCampaignDialogOpen}
        campaign={editingCampaign}
      />
    </div>
  );
}
