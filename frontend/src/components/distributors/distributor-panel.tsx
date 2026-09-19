"use client";

import * as React from "react";
import type { DistributorDTO } from "@ai-sales/shared";
import { Pencil, Trash2 } from "lucide-react";
import { DistributorTypeBadge } from "./distributor-type-badge";
import { DistributorStatusBadge } from "./distributor-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { useDeleteDistributor } from "@/hooks/use-distributors";
import { ApiError } from "@/lib/api-client";

export function DistributorPanel({
  distributor,
  onEdit,
}: {
  distributor: DistributorDTO;
  onEdit: (distributor: DistributorDTO) => void;
}) {
  const { isAdmin, isManager } = usePermissions();
  const canDelete = isAdmin || isManager;

  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const deleteDistributor = useDeleteDistributor();

  async function handleDelete() {
    try {
      await deleteDistributor.mutateAsync(distributor.id);
      toast({ title: "Distributor deleted" });
      setConfirmDeleteOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't delete distributor",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
      setConfirmDeleteOpen(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{distributor.name}</span>
          <DistributorTypeBadge type={distributor.type} />
          <DistributorStatusBadge status={distributor.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {distributor.assignedUserName ? `Assigned to ${distributor.assignedUserName}` : "Unassigned"}
          {distributor.contactEmail ? ` · ${distributor.contactEmail}` : ""}
          {distributor.contactPhone ? ` · ${distributor.contactPhone}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {distributor.stateNames.length === 0 ? (
            <span className="text-xs text-muted-foreground">No territory assigned yet.</span>
          ) : (
            distributor.stateNames.map((name) => (
              <Badge key={name} variant="outline">{name}</Badge>
            ))
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button variant="ghost" size="sm" aria-label="Edit distributor" onClick={() => onEdit(distributor)}>
          <Pencil className="h-4 w-4" />
        </Button>
        {canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Delete distributor"
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this distributor?"
        description={`"${distributor.name}" and its territory assignments will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete distributor"
        isLoading={deleteDistributor.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
