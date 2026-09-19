"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useAccount, useScoreAccount } from "@/hooks/use-leads";
import { usePermissions } from "@/hooks/use-permissions";
import { ClassificationBadge } from "@/components/leads/classification-badge";
import { ScorePanel } from "@/components/leads/score-panel";
import { ScoreHistory } from "@/components/leads/score-history";
import { InsufficientDataNotice } from "@/components/leads/insufficient-data-notice";
import { FeedbackControl } from "@/components/leads/feedback-control";
import { LeadFollowUpsCard } from "@/components/follow-ups/lead-follow-ups-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { isAdmin, isManager } = usePermissions();
  const canManageLeads = isAdmin || isManager;

  const { data, isLoading, isError, error, refetch } = useAccount(id);
  const scoreAccount = useScoreAccount();
  const [missing, setMissing] = React.useState<string[] | null>(null);

  async function handleScore(force = false) {
    if (!id) return;
    setMissing(null);
    try {
      const result = await scoreAccount.mutateAsync({ id, force });
      if (result.status === "ok") {
        toast({ title: "Score updated", description: `${result.score.score} — ${result.score.classification}` });
      } else {
        setMissing(result.missing);
        toast({ title: "Couldn't score this account", description: "Insufficient data.", variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "Couldn't score account",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
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
        title="Couldn't load this account"
        description={error instanceof ApiError ? error.message : "Please try again."}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  }

  const { account, scoreHistory } = data;

  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{account.name}</h1>
            <ClassificationBadge classification={account.latestScore?.classification ?? null} />
          </div>
          <p className="text-sm text-muted-foreground">
            {account.industryName || "No industry set"} · {account.cityName || account.stateName || "No location set"}
          </p>
        </div>
        {canManageLeads ? (
          <div className="flex gap-2">
            <Button onClick={() => handleScore(false)} isLoading={scoreAccount.isPending}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {account.latestScore ? "Rescore" : "Score now"}
            </Button>
            {account.latestScore ? (
              <Button variant="ghost" onClick={() => handleScore(true)} isLoading={scoreAccount.isPending}>
                Force rescore
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Orders</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatNumber(account.orderCount)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total order value</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatCurrency(account.totalOrderValue)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Last order</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">
            {account.lastOrderDate ? formatDate(account.lastOrderDate) : "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Customer since</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatDate(account.createdAt)}</CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Current score</CardTitle>
          </CardHeader>
          <CardContent>
            {missing ? (
              <InsufficientDataNotice missing={missing} />
            ) : account.latestScore ? (
              <ScorePanel score={account.latestScore} />
            ) : (
              <p className="text-sm text-muted-foreground">
                This account hasn&apos;t been scored yet.
                {canManageLeads ? " Click “Score now” to compute one." : " An admin or manager needs to score it."}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {account.latestScore ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rate this score</CardTitle>
              </CardHeader>
              <CardContent>
                <FeedbackControl leadType="accounts" leadId={account.id} />
              </CardContent>
            </Card>
          ) : null}

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

      <LeadFollowUpsCard leadId={account.id} leadType="accounts" leadName={account.name} />
    </div>
  );
}
