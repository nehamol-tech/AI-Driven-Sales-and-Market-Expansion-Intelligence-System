"use client";

import * as React from "react";
import { useCreateSpendRecord } from "@/hooks/use-advertising";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";

interface SpendFormState {
  date: string;
  amount: string;
  impressions: string;
  clicks: string;
}

function emptyForm(): SpendFormState {
  return { date: new Date().toISOString().slice(0, 10), amount: "", impressions: "", clicks: "" };
}

/**
 * Inline form to log a real spend record against a campaign. Any role may
 * add one (mirrors how any role can log a Sales record). Analytics has its
 * own daily cache server-side, so a freshly added record won't show up in
 * totalSpend/etc. until an ADMIN/MANAGER regenerates — the toast says so
 * rather than pretending the number is already live.
 */
export function SpendRecordForm({ campaignId }: { campaignId: string }) {
  const createSpendRecord = useCreateSpendRecord();
  const [form, setForm] = React.useState<SpendFormState>(() => emptyForm());
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.date) {
      setError("Date is required");
      return;
    }
    if (!form.amount.trim() || Number.isNaN(Number(form.amount)) || Number(form.amount) < 0) {
      setError("Enter a valid non-negative amount");
      return;
    }
    setError(null);

    try {
      await createSpendRecord.mutateAsync({
        campaignId,
        input: {
          date: form.date,
          amount: form.amount,
          impressions: form.impressions.trim() ? Number(form.impressions) : null,
          clicks: form.clicks.trim() ? Number(form.clicks) : null,
        },
      });
      toast({
        title: "Spend record logged",
        description: "Regenerate analytics to see it reflected in totalSpend and derived metrics.",
      });
      setForm(emptyForm());
    } catch (err) {
      toast({
        title: "Couldn't log spend record",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="sp-date" className="text-xs">Date</Label>
        <Input
          id="sp-date"
          type="date"
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sp-amount" className="text-xs">Amount</Label>
        <Input
          id="sp-amount"
          inputMode="decimal"
          placeholder="0.00"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sp-impressions" className="text-xs">Impressions</Label>
        <Input
          id="sp-impressions"
          inputMode="numeric"
          placeholder="Optional"
          value={form.impressions}
          onChange={(e) => setForm((f) => ({ ...f, impressions: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sp-clicks" className="text-xs">Clicks</Label>
        <Input
          id="sp-clicks"
          inputMode="numeric"
          placeholder="Optional"
          value={form.clicks}
          onChange={(e) => setForm((f) => ({ ...f, clicks: e.target.value }))}
        />
      </div>
      <Button type="submit" size="sm" isLoading={createSpendRecord.isPending}>
        Add spend
      </Button>
      {error ? <p className="col-span-full text-xs text-destructive">{error}</p> : null}
    </form>
  );
}
