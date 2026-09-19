"use client";

import * as React from "react";
import Link from "next/link";
import type { FollowUpDTO } from "@ai-sales/shared";
import { CalendarClock, Trash2 } from "lucide-react";
import { FollowUpStatusBadge } from "./follow-up-status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDeleteFollowUp, useUpdateFollowUp } from "@/hooks/use-follow-ups";
import { usePermissions } from "@/hooks/use-permissions";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";

/**
 * One follow-up: lead name (linking to its detail page), due date, status
 * badge, notes preview, assigned-to name, and actions. `completedAt` is
 * never rendered as an editable field anywhere here — completion is a
 * status transition (`status: "COMPLETED"`), and the server derives the
 * real timestamp; the optional completion-notes box is the only thing the
 * user types.
 */
export function FollowUpRow({
  followUp,
  onReschedule,
  hideLeadLink = false,
}: {
  followUp: FollowUpDTO;
  onReschedule: (followUp: FollowUpDTO) => void;
  hideLeadLink?: boolean;
}) {
  const { isAdmin, isManager } = usePermissions();
  const canDelete = isAdmin || isManager;

  const updateFollowUp = useUpdateFollowUp();
  const deleteFollowUp = useDeleteFollowUp();

  const [completing, setCompleting] = React.useState(false);
  const [completionNotes, setCompletionNotes] = React.useState("");
  const [confirmCancelOpen, setConfirmCancelOpen] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  async function handleComplete() {
    try {
      await updateFollowUp.mutateAsync({
        id: followUp.id,
        input: { status: "COMPLETED", completionNotes: completionNotes.trim() || undefined },
      });
      toast({ title: "Follow-up marked complete" });
      setCompleting(false);
      setCompletionNotes("");
    } catch (err) {
      toast({
        title: "Couldn't complete follow-up",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleCancel() {
    try {
      await updateFollowUp.mutateAsync({ id: followUp.id, input: { status: "CANCELLED" } });
      toast({ title: "Follow-up cancelled" });
      setConfirmCancelOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't cancel follow-up",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
      setConfirmCancelOpen(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteFollowUp.mutateAsync(followUp.id);
      toast({ title: "Follow-up deleted" });
      setConfirmDeleteOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't delete follow-up",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
      setConfirmDeleteOpen(false);
    }
  }

  const isPending = followUp.status === "PENDING";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {hideLeadLink ? (
              <span className="font-medium">{followUp.leadName}</span>
            ) : (
              <Link
                href={`/leads/${followUp.leadType}/${followUp.leadId}`}
                className="font-medium hover:underline"
              >
                {followUp.leadName}
              </Link>
            )}
            <FollowUpStatusBadge status={followUp.status} dueDate={followUp.dueDate} />
          </div>
          <p className="text-sm text-muted-foreground">Due {formatDate(followUp.dueDate)}</p>
          {followUp.notes ? <p className="text-sm">{followUp.notes}</p> : null}
          {followUp.status === "COMPLETED" && followUp.completionNotes ? (
            <p className="text-sm text-muted-foreground">
              Completion notes: {followUp.completionNotes}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Assigned to {followUp.assignedUserName ?? "Unassigned"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {isPending ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setCompleting((v) => !v)}>
                Mark complete
              </Button>
              <Button variant="outline" size="sm" onClick={() => onReschedule(followUp)}>
                <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                Reschedule
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmCancelOpen(true)}>
                Cancel
              </Button>
            </>
          ) : null}
          {canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Delete follow-up"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          ) : null}
        </div>
      </div>

      {completing ? (
        <div className="mt-3 space-y-2 rounded-md border border-dashed border-border bg-muted/30 p-3">
          <Textarea
            placeholder="Completion notes (optional)"
            value={completionNotes}
            onChange={(e) => setCompletionNotes(e.target.value)}
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCompleting(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleComplete} isLoading={updateFollowUp.isPending}>
              Confirm complete
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmCancelOpen}
        onOpenChange={setConfirmCancelOpen}
        title="Cancel this follow-up?"
        description={`The follow-up for "${followUp.leadName}" will be marked cancelled.`}
        confirmLabel="Cancel follow-up"
        isLoading={updateFollowUp.isPending}
        onConfirm={handleCancel}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this follow-up?"
        description={`The follow-up for "${followUp.leadName}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete follow-up"
        isLoading={deleteFollowUp.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
