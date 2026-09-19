"use client";

import * as React from "react";
import { AD_PLATFORMS, type AdCampaignDTO, type AdPlatform } from "@ai-sales/shared";
import {
  useCreateAdCampaign,
  useUpdateAdCampaign,
  type AdCampaignInput,
} from "@/hooks/use-advertising";
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

const PLATFORM_LABELS: Record<AdPlatform, string> = { META: "Meta", GOOGLE: "Google" };

interface CampaignFormState {
  name: string;
  platform: AdPlatform;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export function CampaignDialog({
  open,
  onOpenChange,
  campaign,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: AdCampaignDTO | null;
  onSaved?: (campaign: AdCampaignDTO) => void;
}) {
  const isEdit = Boolean(campaign);
  const createCampaign = useCreateAdCampaign();
  const updateCampaign = useUpdateAdCampaign();

  const [form, setForm] = React.useState<CampaignFormState>(() => emptyForm());
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    if (campaign) {
      setForm({
        name: campaign.name,
        platform: campaign.platform,
        startDate: campaign.startDate.slice(0, 10),
        endDate: campaign.endDate ? campaign.endDate.slice(0, 10) : "",
        isActive: campaign.isActive,
      });
    } else {
      setForm(emptyForm());
    }
    setErrors({});
  }, [open, campaign]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Campaign name is required";
    if (!form.startDate) next.startDate = "Start date is required";
    if (form.endDate && form.startDate && form.endDate < form.startDate) {
      next.endDate = "End date can't be before the start date";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    try {
      let saved: AdCampaignDTO;
      if (isEdit && campaign) {
        const input: Partial<AdCampaignInput> = {
          name: form.name,
          startDate: form.startDate,
          endDate: form.endDate || null,
          isActive: form.isActive,
        };
        saved = await updateCampaign.mutateAsync({ id: campaign.id, input });
        toast({ title: "Campaign updated" });
      } else {
        const input: AdCampaignInput = {
          name: form.name,
          platform: form.platform,
          startDate: form.startDate,
          endDate: form.endDate || null,
          isActive: form.isActive,
        };
        saved = await createCampaign.mutateAsync(input);
        toast({ title: "Campaign created" });
      }
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      toast({
        title: isEdit ? "Couldn't update campaign" : "Couldn't create campaign",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const isSubmitting = createCampaign.isPending || updateCampaign.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit campaign" : "New campaign"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="camp-name">Campaign name</Label>
            <Input
              id="camp-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label>Platform</Label>
            <Select
              value={form.platform}
              onValueChange={(v) => setForm((f) => ({ ...f, platform: v as AdPlatform }))}
              disabled={isEdit}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AD_PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>{PLATFORM_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit ? (
              <p className="text-xs text-muted-foreground">Platform can&apos;t be changed after a campaign is created.</p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="camp-start">Start date</Label>
              <Input
                id="camp-start"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
              {errors.startDate ? <p className="text-xs text-destructive">{errors.startDate}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="camp-end">End date (optional)</Label>
              <Input
                id="camp-end"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
              {errors.endDate ? <p className="text-xs text-destructive">{errors.endDate}</p> : null}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Active
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? "Save changes" : "Create campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function emptyForm(): CampaignFormState {
  return {
    name: "",
    platform: "META",
    startDate: "",
    endDate: "",
    isActive: true,
  };
}
