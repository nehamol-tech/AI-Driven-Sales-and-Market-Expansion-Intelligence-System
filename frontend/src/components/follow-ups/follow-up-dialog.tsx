"use client";

import * as React from "react";
import type { FollowUpDTO, LeadType } from "@ai-sales/shared";
import { useCreateFollowUp, useUpdateFollowUp } from "@/hooks/use-follow-ups";
import { useAccounts, useProspects } from "@/hooks/use-leads";
import { useUsers } from "@/hooks/use-users";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";

export interface FollowUpLeadContext {
  leadId: string;
  leadType: LeadType;
  leadName: string;
}

/**
 * Create/reschedule form.
 *
 * - When `followUp` is set, this is a reschedule/edit of an existing
 *   follow-up — the lead is fixed to that follow-up's own lead (a follow-up
 *   never moves to a different lead), and only dueDate/notes/assignedUserId
 *   are sent (never `status` or `completedAt` — those are set elsewhere).
 * - When `lead` is set (and `followUp` isn't), this is a create opened from
 *   a lead detail page — the lead is fixed, no picker shown.
 * - When neither is set, this is a create opened from the standalone
 *   /follow-ups page — a simple lead-type Select plus a text-filtered
 *   Select of that type's existing leads (reusing useAccounts/useProspects'
 *   own `search` filter server-side, no separate client search logic).
 */
export function FollowUpDialog({
  open,
  onOpenChange,
  followUp = null,
  lead = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUp?: FollowUpDTO | null;
  lead?: FollowUpLeadContext | null;
}) {
  const isEdit = Boolean(followUp);
  const { isAdmin, isManager } = usePermissions();
  const canAssign = isAdmin || isManager;
  const { data: users } = useUsers();

  const createFollowUp = useCreateFollowUp();
  const updateFollowUp = useUpdateFollowUp();

  const fixedLead: FollowUpLeadContext | null = followUp
    ? { leadId: followUp.leadId, leadType: followUp.leadType, leadName: followUp.leadName }
    : lead;

  const [leadType, setLeadType] = React.useState<LeadType>(fixedLead?.leadType ?? "accounts");
  const [leadId, setLeadId] = React.useState<string>(fixedLead?.leadId ?? "");
  const [leadSearch, setLeadSearch] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [assignedUserId, setAssignedUserId] = React.useState<string>("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const { data: accountsPage } = useAccounts({ search: leadSearch || undefined, pageSize: 50 });
  const { data: prospectsPage } = useProspects({ search: leadSearch || undefined, pageSize: 50 });

  React.useEffect(() => {
    if (!open) return;
    if (followUp) {
      setLeadType(followUp.leadType);
      setLeadId(followUp.leadId);
      setDueDate(followUp.dueDate.slice(0, 10));
      setNotes(followUp.notes ?? "");
      setAssignedUserId(followUp.assignedUserId ?? "");
    } else if (lead) {
      setLeadType(lead.leadType);
      setLeadId(lead.leadId);
      setDueDate("");
      setNotes("");
      setAssignedUserId("");
    } else {
      setLeadType("accounts");
      setLeadId("");
      setDueDate("");
      setNotes("");
      setAssignedUserId("");
    }
    setLeadSearch("");
    setErrors({});
  }, [open, followUp, lead]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!fixedLead && !leadId) next.leadId = "Select an account or prospect";
    if (!dueDate) next.dueDate = "Due date is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    try {
      if (isEdit && followUp) {
        await updateFollowUp.mutateAsync({
          id: followUp.id,
          input: {
            dueDate,
            notes: notes.trim() || undefined,
            assignedUserId: canAssign && assignedUserId ? assignedUserId : undefined,
          },
        });
        toast({ title: "Follow-up rescheduled" });
      } else {
        const targetLeadId = fixedLead?.leadId ?? leadId;
        const targetLeadType = fixedLead?.leadType ?? leadType;
        await createFollowUp.mutateAsync({
          leadId: targetLeadId,
          leadType: targetLeadType,
          dueDate,
          notes: notes.trim() || undefined,
          assignedUserId: canAssign && assignedUserId ? assignedUserId : undefined,
        });
        toast({ title: "Follow-up scheduled" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: isEdit ? "Couldn't reschedule follow-up" : "Couldn't schedule follow-up",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const isSubmitting = createFollowUp.isPending || updateFollowUp.isPending;
  const leadOptions =
    leadType === "accounts"
      ? (accountsPage?.data ?? []).map((a) => ({ id: a.id, name: a.name }))
      : (prospectsPage?.data ?? []).map((p) => ({ id: p.id, name: p.businessName }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Reschedule follow-up" : "Schedule follow-up"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {fixedLead ? (
            <div className="space-y-1.5">
              <Label>Lead</Label>
              <Input value={fixedLead.leadName} disabled />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Lead type</Label>
                <Select
                  value={leadType}
                  onValueChange={(v) => {
                    setLeadType(v as LeadType);
                    setLeadId("");
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="accounts">Account</SelectItem>
                    <SelectItem value="prospects">Prospect</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fu-lead-search">
                  {leadType === "accounts" ? "Account" : "Prospect"}
                </Label>
                <Input
                  id="fu-lead-search"
                  placeholder="Search by name..."
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  className="mb-1.5"
                />
                <Select value={leadId} onValueChange={setLeadId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={`Select a ${leadType === "accounts" ? "account" : "prospect"}`}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {leadOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">No matches</div>
                    ) : (
                      leadOptions.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {errors.leadId ? <p className="text-xs text-destructive">{errors.leadId}</p> : null}
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="fu-due">Due date</Label>
            <Input
              id="fu-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            {errors.dueDate ? <p className="text-xs text-destructive">{errors.dueDate}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fu-notes">Notes</Label>
            <Textarea
              id="fu-notes"
              placeholder="What needs to happen at this follow-up? (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {canAssign ? (
            <div className="space-y-1.5">
              <Label>Assigned to</Label>
              <Select value={assignedUserId} onValueChange={setAssignedUserId}>
                <SelectTrigger><SelectValue placeholder="Unassigned (defaults to you)" /></SelectTrigger>
                <SelectContent>
                  {users?.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? "Save changes" : "Schedule follow-up"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
