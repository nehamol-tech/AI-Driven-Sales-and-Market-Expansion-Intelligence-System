"use client";

import * as React from "react";
import type { AdCampaignDTO, CampaignAnalyticsDTO, MetricValue } from "@ai-sales/shared";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { PlatformBadge } from "./platform-badge";
import { CampaignSourceBadge } from "./campaign-source-badge";
import { SpendRecordForm } from "./spend-record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { useDeleteAdCampaign, useDeleteSpendRecord, useSpendRecords } from "@/hooks/use-advertising";
import { ApiError } from "@/lib/api-client";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";

/** Small inline sibling of MetricCard for values that live inside a compact campaign row rather than their own card. */
function InlineMetric<T>({
  label,
  metric,
  format,
}: {
  label: string;
  metric: MetricValue<T>;
  format: (v: T) => React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">
        {metric.status === "ok" ? format(metric.value) : (
          <span className="font-normal text-muted-foreground">Insufficient data</span>
        )}
      </p>
    </div>
  );
}

export function CampaignPanel({
  campaign,
  analytics,
  onEdit,
}: {
  campaign: AdCampaignDTO;
  analytics: CampaignAnalyticsDTO | undefined;
  onEdit: (campaign: AdCampaignDTO) => void;
}) {
  const { isAdmin, isManager } = usePermissions();
  const canDelete = isAdmin || isManager;

  const [expanded, setExpanded] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  const deleteCampaign = useDeleteAdCampaign();
  const deleteSpendRecord = useDeleteSpendRecord();
  const {
    data: spendRecords,
    isLoading: isSpendLoading,
    isError: isSpendError,
  } = useSpendRecords(expanded ? campaign.id : null);

  async function handleDelete() {
    try {
      await deleteCampaign.mutateAsync(campaign.id);
      toast({ title: "Campaign deleted" });
      setConfirmDeleteOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't delete campaign",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
      setConfirmDeleteOpen(false);
    }
  }

  async function handleDeleteSpend(spendId: string) {
    try {
      await deleteSpendRecord.mutateAsync({ campaignId: campaign.id, spendId });
      toast({ title: "Spend record deleted" });
    } catch (err) {
      toast({
        title: "Couldn't delete spend record",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{campaign.name}</span>
              <PlatformBadge platform={campaign.platform} />
              <CampaignSourceBadge source={campaign.source} />
              {!campaign.isActive ? <Badge variant="outline">Inactive</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDate(campaign.startDate)}
              {campaign.endDate ? ` – ${formatDate(campaign.endDate)}` : " – ongoing"}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="ghost" size="sm" aria-label="Edit campaign" onClick={() => onEdit(campaign)}>
            <Pencil className="h-4 w-4" />
          </Button>
          {canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Delete campaign"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-border p-4">
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Analytics
            </h4>
            {analytics ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <p className="text-xs text-muted-foreground">Total spend</p>
                  <p className="text-sm font-semibold">{formatCurrency(analytics.totalSpend)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Leads generated</p>
                  <p className="text-sm font-semibold">{formatNumber(analytics.leadsGenerated)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Leads won</p>
                  <p className="text-sm font-semibold">{formatNumber(analytics.leadsWon)}</p>
                </div>
                <InlineMetric
                  label="Cost per lead"
                  metric={analytics.costPerLead}
                  format={(v) => formatCurrency(v)}
                />
                <InlineMetric
                  label="Attributed revenue"
                  metric={analytics.attributedRevenue}
                  format={(v) => formatCurrency(v)}
                />
                <InlineMetric
                  label="ROAS"
                  metric={analytics.roas}
                  format={(v) => `${v.toFixed(2)}x`}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not included in the latest analytics run yet — regenerate analytics to see it here.
              </p>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Spend records
            </h4>
            {isSpendLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : isSpendError ? (
              <p className="text-sm text-muted-foreground">Unable to load spend records.</p>
            ) : !spendRecords || spendRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground">No spend logged yet for this campaign.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {spendRecords.map((record) => (
                  <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-medium">{formatDate(record.date)}</span>
                      <span>{formatCurrency(record.amount)}</span>
                      <span className="text-muted-foreground">
                        {record.impressions !== null ? `${formatNumber(record.impressions)} impr.` : "— impr."}
                      </span>
                      <span className="text-muted-foreground">
                        {record.clicks !== null ? `${formatNumber(record.clicks)} clicks` : "— clicks"}
                      </span>
                      <CampaignSourceBadge source={record.source} />
                    </div>
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Delete spend record"
                        onClick={() => handleDeleteSpend(record.id)}
                        isLoading={
                          deleteSpendRecord.isPending && deleteSpendRecord.variables?.spendId === record.id
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Add spend record
            </h4>
            <SpendRecordForm campaignId={campaign.id} />
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this campaign?"
        description={`"${campaign.name}" and all of its spend records will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete campaign"
        isLoading={deleteCampaign.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
