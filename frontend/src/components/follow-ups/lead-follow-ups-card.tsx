"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import type { FollowUpDTO, LeadType } from "@ai-sales/shared";
import { useFollowUps } from "@/hooks/use-follow-ups";
import { FollowUpDialog, type FollowUpLeadContext } from "./follow-up-dialog";
import { FollowUpRow } from "./follow-up-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A lead detail page's "Follow-ups" section. The follow-ups API filters by
 * `leadType` only, not a specific `leadId` — so this fetches a generously
 * sized list scoped to this lead's leadType and filters client-side by
 * `leadId`. This is a reasonable simplification for Phase 5's scope given a
 * single lead's own follow-up count is small; it is not worth adding a new
 * backend query param just for this.
 */
export function LeadFollowUpsCard({
  leadId,
  leadType,
  leadName,
}: {
  leadId: string;
  leadType: LeadType;
  leadName: string;
}) {
  const { data, isLoading } = useFollowUps({ leadType, dueBy: "all", limit: 200 });
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingFollowUp, setEditingFollowUp] = React.useState<FollowUpDTO | null>(null);

  const items = (data?.items ?? []).filter((f) => f.leadId === leadId);

  function openCreate() {
    setEditingFollowUp(null);
    setDialogOpen(true);
  }
  function openReschedule(followUp: FollowUpDTO) {
    setEditingFollowUp(followUp);
    setDialogOpen(true);
  }

  const lead: FollowUpLeadContext = { leadId, leadType, leadName };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Follow-ups</CardTitle>
        <Button variant="outline" size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Schedule follow-up
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No follow-ups scheduled yet.</p>
        ) : (
          items.map((followUp) => (
            <FollowUpRow
              key={followUp.id}
              followUp={followUp}
              onReschedule={openReschedule}
              hideLeadLink
            />
          ))
        )}
      </CardContent>

      <FollowUpDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingFollowUp(null);
        }}
        followUp={editingFollowUp}
        lead={editingFollowUp ? null : lead}
      />
    </Card>
  );
}
