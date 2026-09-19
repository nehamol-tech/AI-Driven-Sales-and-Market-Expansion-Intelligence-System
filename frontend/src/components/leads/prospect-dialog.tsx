"use client";

import * as React from "react";
import type { ProspectDTO } from "@ai-sales/shared";
import {
  useCreateProspect,
  useUpdateProspect,
  type ProspectInput,
} from "@/hooks/use-leads";
import { useIndustries, useBusinessTypes } from "@/hooks/use-industries";
import { useStates, useCities } from "@/hooks/use-states";
import { useUsers } from "@/hooks/use-users";
import { useProducts } from "@/hooks/use-products";
import { useAdCampaigns } from "@/hooks/use-advertising";
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

export function ProspectDialog({
  open,
  onOpenChange,
  prospect,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prospect: ProspectDTO | null;
  onSaved?: (prospect: ProspectDTO) => void;
}) {
  const isEdit = Boolean(prospect);
  const { data: industries } = useIndustries();
  const { data: businessTypes } = useBusinessTypes();
  const { data: states } = useStates();
  const { data: users } = useUsers();
  const { data: productsPage } = useProducts({ pageSize: 100, isActive: true });
  const { data: campaignsPage } = useAdCampaigns();

  const createProspect = useCreateProspect();
  const updateProspect = useUpdateProspect();

  const [form, setForm] = React.useState<ProspectInput>(() => emptyForm());
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const { data: cities } = useCities(form.stateId || undefined);

  React.useEffect(() => {
    if (!open) return;
    if (prospect) {
      setForm({
        businessName: prospect.businessName,
        industryId: prospect.industryId,
        businessTypeId: prospect.businessTypeId,
        stateId: prospect.stateId,
        cityId: prospect.cityId,
        website: prospect.website ?? "",
        contactEmail: prospect.contactEmail ?? "",
        contactPhone: prospect.contactPhone ?? "",
        assignedUserId: prospect.assignedUserId,
        productsOfInterestIds: prospect.productsOfInterestIds,
        campaignId: prospect.campaignId,
      });
    } else {
      setForm(emptyForm());
    }
    setErrors({});
  }, [open, prospect]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.businessName.trim()) next.businessName = "Business name is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const input: ProspectInput = {
      ...form,
      website: form.website || null,
      contactEmail: form.contactEmail || null,
      contactPhone: form.contactPhone || null,
    };

    try {
      let saved: ProspectDTO;
      if (isEdit && prospect) {
        saved = await updateProspect.mutateAsync({ id: prospect.id, input });
        toast({ title: "Prospect updated" });
      } else {
        saved = await createProspect.mutateAsync(input);
        toast({ title: "Prospect created" });
      }
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      toast({
        title: isEdit ? "Couldn't update prospect" : "Couldn't create prospect",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const isSubmitting = createProspect.isPending || updateProspect.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit prospect" : "New prospect"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="pr-name">Business name</Label>
            <Input
              id="pr-name"
              value={form.businessName}
              onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
            />
            {errors.businessName ? (
              <p className="text-xs text-destructive">{errors.businessName}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Industry</Label>
              <Select
                value={form.industryId ?? ""}
                onValueChange={(v) => setForm((f) => ({ ...f, industryId: v || null }))}
              >
                <SelectTrigger><SelectValue placeholder="Select an industry (optional)" /></SelectTrigger>
                <SelectContent>
                  {industries?.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Business type</Label>
              <Select
                value={form.businessTypeId ?? ""}
                onValueChange={(v) => setForm((f) => ({ ...f, businessTypeId: v || null }))}
              >
                <SelectTrigger><SelectValue placeholder="Select a type (optional)" /></SelectTrigger>
                <SelectContent>
                  {businessTypes?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>State</Label>
              <Select
                value={form.stateId ?? ""}
                onValueChange={(v) => setForm((f) => ({ ...f, stateId: v || null, cityId: null }))}
              >
                <SelectTrigger><SelectValue placeholder="Select a state (optional)" /></SelectTrigger>
                <SelectContent>
                  {states?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Select
                value={form.cityId ?? ""}
                onValueChange={(v) => setForm((f) => ({ ...f, cityId: v || null }))}
                disabled={!form.stateId}
              >
                <SelectTrigger><SelectValue placeholder="Select a city (optional)" /></SelectTrigger>
                <SelectContent>
                  {cities?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Industry and state/city help the scoring engine judge fit — a prospect
            missing both won&apos;t be scoreable yet.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-website">Website</Label>
              <Input
                id="pr-website"
                value={form.website ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-email">Contact email</Label>
              <Input
                id="pr-email"
                type="email"
                value={form.contactEmail ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-phone">Contact phone</Label>
              <Input
                id="pr-phone"
                value={form.contactPhone ?? ""}
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

          <ProductInterestList
            options={productsPage?.data ?? []}
            selectedIds={form.productsOfInterestIds ?? []}
            onChange={(ids) => setForm((f) => ({ ...f, productsOfInterestIds: ids }))}
          />

          <div className="space-y-1.5">
            <Label>Attributed campaign</Label>
            <Select
              value={form.campaignId ?? ""}
              onValueChange={(v) => setForm((f) => ({ ...f, campaignId: v || null }))}
            >
              <SelectTrigger><SelectValue placeholder="No campaign (optional)" /></SelectTrigger>
              <SelectContent>
                {campaignsPage?.data.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Which ad campaign, if any, brought this prospect in — feeds advertising analytics.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? "Save changes" : "Create prospect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductInterestList({
  options,
  selectedIds,
  onChange,
}: {
  options: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  }

  return (
    <div className="space-y-1.5">
      <Label>Products of interest</Label>
      <div className="max-h-32 overflow-y-auto rounded-md border border-border p-2">
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active products yet.</p>
        ) : (
          <div className="space-y-1">
            {options.map((opt) => (
              <label key={opt.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border"
                  checked={selectedIds.includes(opt.id)}
                  onChange={() => toggle(opt.id)}
                />
                {opt.name}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function emptyForm(): ProspectInput {
  return {
    businessName: "",
    industryId: null,
    businessTypeId: null,
    stateId: null,
    cityId: null,
    website: "",
    contactEmail: "",
    contactPhone: "",
    assignedUserId: null,
    productsOfInterestIds: [],
    campaignId: null,
  };
}
