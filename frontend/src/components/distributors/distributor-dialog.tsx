"use client";

import * as React from "react";
import { DISTRIBUTOR_STATUSES, DISTRIBUTOR_TYPES, type DistributorDTO, type DistributorStatus, type DistributorType } from "@ai-sales/shared";
import {
  useCreateDistributor,
  useUpdateDistributor,
  type DistributorInput,
} from "@/hooks/use-distributors";
import { useUsers } from "@/hooks/use-users";
import { useStates } from "@/hooks/use-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const TYPE_LABELS: Record<DistributorType, string> = { DISTRIBUTOR: "Distributor", DEALER: "Dealer" };
const STATUS_LABELS: Record<DistributorStatus, string> = {
  PROSPECTIVE: "Prospective",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

interface DistributorFormState {
  name: string;
  type: DistributorType;
  status: DistributorStatus;
  contactEmail: string;
  contactPhone: string;
  assignedUserId: string | null;
  stateIds: string[];
}

export function DistributorDialog({
  open,
  onOpenChange,
  distributor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  distributor: DistributorDTO | null;
  onSaved?: (distributor: DistributorDTO) => void;
}) {
  const isEdit = Boolean(distributor);
  const { data: users } = useUsers();
  const { data: states } = useStates();

  const createDistributor = useCreateDistributor();
  const updateDistributor = useUpdateDistributor();

  const [form, setForm] = React.useState<DistributorFormState>(() => emptyForm());
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    if (distributor) {
      setForm({
        name: distributor.name,
        type: distributor.type,
        status: distributor.status,
        contactEmail: distributor.contactEmail ?? "",
        contactPhone: distributor.contactPhone ?? "",
        assignedUserId: distributor.assignedUserId,
        stateIds: distributor.stateIds,
      });
    } else {
      setForm(emptyForm());
    }
    setErrors({});
  }, [open, distributor]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Distributor name is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const input: DistributorInput = {
      name: form.name,
      type: form.type,
      status: form.status,
      contactEmail: form.contactEmail || null,
      contactPhone: form.contactPhone || null,
      assignedUserId: form.assignedUserId || null,
      stateIds: form.stateIds,
    };

    try {
      let saved: DistributorDTO;
      if (isEdit && distributor) {
        saved = await updateDistributor.mutateAsync({ id: distributor.id, input });
        toast({ title: "Distributor updated" });
      } else {
        saved = await createDistributor.mutateAsync(input);
        toast({ title: "Distributor created" });
      }
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      toast({
        title: isEdit ? "Couldn't update distributor" : "Couldn't create distributor",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  function toggleState(id: string) {
    setForm((f) =>
      f.stateIds.includes(id)
        ? { ...f, stateIds: f.stateIds.filter((x) => x !== id) }
        : { ...f, stateIds: [...f.stateIds, id] }
    );
  }

  const isSubmitting = createDistributor.isPending || updateDistributor.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit distributor" : "New distributor"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="dist-name">Name</Label>
            <Input
              id="dist-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v as DistributorType }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DISTRIBUTOR_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as DistributorStatus }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DISTRIBUTOR_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dist-email">Contact email</Label>
              <Input
                id="dist-email"
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dist-phone">Contact phone</Label>
              <Input
                id="dist-phone"
                value={form.contactPhone}
                onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Assigned to</Label>
            <Select
              value={form.assignedUserId ?? ""}
              onValueChange={(v) => setForm((f) => ({ ...f, assignedUserId: v || null }))}
            >
              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                {users?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Territory (states covered)</Label>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2">
              {!states || states.length === 0 ? (
                <p className="text-xs text-muted-foreground">No states available.</p>
              ) : (
                <div className="space-y-1">
                  {states.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-border"
                        checked={form.stateIds.includes(s.id)}
                        onChange={() => toggleState(s.id)}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Which states this distributor covers — saving replaces the full territory set.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? "Save changes" : "Create distributor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function emptyForm(): DistributorFormState {
  return {
    name: "",
    type: "DISTRIBUTOR",
    status: "PROSPECTIVE",
    contactEmail: "",
    contactPhone: "",
    assignedUserId: null,
    stateIds: [],
  };
}
