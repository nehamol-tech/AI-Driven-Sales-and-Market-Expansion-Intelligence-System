"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Sparkles, Trash2 } from "lucide-react";
import { PROSPECT_STATUSES, type ProspectStatus } from "@ai-sales/shared";
import { useProspect, useScoreProspect, useDeleteProspect, useUpdateProspect } from "@/hooks/use-leads";
import { useProducts } from "@/hooks/use-products";
import { usePermissions } from "@/hooks/use-permissions";
import { ClassificationBadge } from "@/components/leads/classification-badge";
import { ScorePanel } from "@/components/leads/score-panel";
import { ScoreHistory } from "@/components/leads/score-history";
import { InsufficientDataNotice } from "@/components/leads/insufficient-data-notice";
import { FeedbackControl } from "@/components/leads/feedback-control";
import { ProspectDialog } from "@/components/leads/prospect-dialog";
import { LeadFollowUpsCard } from "@/components/follow-ups/lead-follow-ups-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";

export default function ProspectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { isAdmin, isManager } = usePermissions();
  const canManageLeads = isAdmin || isManager;

  const { data, isLoading, isError, error, refetch } = useProspect(id);
  const { data: productsPage } = useProducts({ pageSize: 100 });
  const scoreProspect = useScoreProspect();
  const deleteProspect = useDeleteProspect();
  const updateProspect = useUpdateProspect();
  const [missing, setMissing] = React.useState<string[] | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  async function handleStatusChange(newStatus: string) {
    if (!id || newStatus === data?.prospect.status) return;
    try {
      await updateProspect.mutateAsync({ id, input: { status: newStatus as ProspectStatus } });
      toast({ title: "Stage updated", description: newStatus });
    } catch (err) {
      toast({
        title: "Couldn't update stage",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleScore(force = false) {
    if (!id) return;
    setMissing(null);
    try {
      const result = await scoreProspect.mutateAsync({ id, force });
      if (result.status === "ok") {
        toast({ title: "Score updated", description: `${result.score.score} — ${result.score.classification}` });
      } else {
        setMissing(result.missing);
        toast({ title: "Couldn't score this prospect", description: "Insufficient data.", variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "Couldn't score prospect",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (!id) return;
    try {
      await deleteProspect.mutateAsync(id);
      toast({ title: "Prospect deleted" });
      router.push("/leads");
    } catch (err) {
      toast({
        title: "Couldn't delete prospect",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
      setConfirmDeleteOpen(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        title="Couldn't load this prospect"
        description={error instanceof ApiError ? error.message : "Please try again."}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  }

  const { prospect, scoreHistory } = data;
  const productNames = prospect.productsOfInterestIds
    .map((pid) => productsPage?.data.find((p) => p.id === pid)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{prospect.businessName}</h1>
            <ClassificationBadge classification={prospect.latestScore?.classification ?? null} />
            <Select value={prospect.status} onValueChange={handleStatusChange}>
              <SelectTrigger className="h-7 w-40 text-xs" disabled={updateProspect.isPending}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROSPECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm text-muted-foreground">
            {prospect.industryName || "No industry set"} · {prospect.cityName || prospect.stateName || "No location set"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1.5 h-4 w-4" />
            Edit
          </Button>
          {canManageLeads ? (
            <Button variant="outline" className="text-destructive" onClick={() => setConfirmDeleteOpen(true)}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </Button>
          ) : null}
          {canManageLeads ? (
            <Button onClick={() => handleScore(false)} isLoading={scoreProspect.isPending}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {prospect.latestScore ? "Rescore" : "Score now"}
            </Button>
          ) : null}
          {canManageLeads && prospect.latestScore ? (
            <Button variant="ghost" onClick={() => handleScore(true)} isLoading={scoreProspect.isPending}>
              Force rescore
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current score</CardTitle>
            </CardHeader>
            <CardContent>
              {missing ? (
                <InsufficientDataNotice missing={missing} />
              ) : prospect.latestScore ? (
                <ScorePanel score={prospect.latestScore} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  This prospect hasn&apos;t been scored yet.
                  {canManageLeads ? " Click “Score now” to compute one." : " An admin or manager needs to score it."}
                </p>
              )}
            </CardContent>
          </Card>

          {prospect.latestScore ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rate this score</CardTitle>
              </CardHeader>
              <CardContent>
                <FeedbackControl leadType="prospects" leadId={prospect.id} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <ProfileRow label="Business type" value={prospect.businessTypeName} />
              <ProfileRow label="Website" value={prospect.website} />
              <ProfileRow label="Contact email" value={prospect.contactEmail} />
              <ProfileRow label="Contact phone" value={prospect.contactPhone} />
              <ProfileRow label="Assigned to" value={prospect.assignedUserName ?? "Unassigned"} />
              <ProfileRow label="Source" value={prospect.source} />
              <ProfileRow label="Added" value={formatDate(prospect.createdAt)} />
              <ProfileRow
                label="Products of interest"
                value={productNames.length > 0 ? productNames.join(", ") : "None"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Score history</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreHistory history={scoreHistory} />
            </CardContent>
          </Card>
        </div>
      </div>

      <LeadFollowUpsCard leadId={prospect.id} leadType="prospects" leadName={prospect.businessName} />

      <ProspectDialog open={editOpen} onOpenChange={setEditOpen} prospect={prospect} />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this prospect?"
        description={`"${prospect.businessName}" and its score history will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete prospect"
        isLoading={deleteProspect.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || "—"}</span>
    </div>
  );
}
