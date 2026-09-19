"use client";

import * as React from "react";
import Link from "next/link";
import type {
  LeadClassification,
  MarketOpportunityClassification,
  OptimizationRecommendationDTO,
  OptimizationRecommendationStatus,
  OptimizationRecommendationType,
} from "@ai-sales/shared";
import { Check, X } from "lucide-react";
import { MethodBadge } from "@/components/leads/method-badge";
import { ClassificationBadge } from "@/components/leads/classification-badge";
import { ClassificationLabel } from "@/components/market-expansion/classification-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { useApproveRecommendation, useRejectRecommendation } from "@/hooks/use-optimization";
import { ApiError } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/utils";

const TYPE_LABELS: Record<OptimizationRecommendationType, string> = {
  SCHEDULE_FOLLOW_UP: "Schedule follow-up",
  AT_RISK_FOLLOW_UP: "At-risk account",
  PAUSE_UNDERPERFORMING_CAMPAIGN: "Pause underperforming campaign",
  DISTRIBUTOR_EXPANSION_ADVISORY: "Distributor expansion opportunity",
};

const STATUS_STYLES: Record<OptimizationRecommendationStatus, string> = {
  PENDING: "border-transparent bg-amber-950/50 text-amber-400",
  APPROVED: "border-transparent bg-amber-950/50 text-amber-400",
  REJECTED: "border-border text-muted-foreground bg-muted/50",
  EXECUTED: "border-transparent bg-emerald-950/50 text-emerald-400",
  EXECUTION_FAILED: "border-transparent bg-destructive/15 text-destructive",
};

const STATUS_LABELS: Record<OptimizationRecommendationStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXECUTED: "Executed",
  EXECUTION_FAILED: "Execution failed",
};

function StatusBadge({ status }: { status: OptimizationRecommendationStatus }) {
  return (
    <Badge variant={status === "REJECTED" ? "outline" : "default"} className={STATUS_STYLES[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function targetHref(recommendation: OptimizationRecommendationDTO): string | null {
  if (recommendation.targetType === "ACCOUNT") return `/leads/accounts/${recommendation.targetId}`;
  if (recommendation.targetType === "PROSPECT") return `/leads/prospects/${recommendation.targetId}`;
  return null;
}

function formatEvidenceKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "Not available";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Generic label/value fallback for evidence shapes not given a dedicated renderer below. */
function GenericEvidence({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-2 sm:justify-start">
          <dt className="text-muted-foreground">{formatEvidenceKey(key)}</dt>
          <dd className="font-medium">{formatEvidenceValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Real evidence rendered per-type, matching each type's actual verified shape rather than a generic dump. */
function Evidence({ recommendation }: { recommendation: OptimizationRecommendationDTO }) {
  const { type, evidence } = recommendation;

  if (type === "SCHEDULE_FOLLOW_UP") {
    const classification = evidence.classification as LeadClassification | undefined;
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Classification</span>
        <ClassificationBadge classification={classification ?? null} />
      </div>
    );
  }

  if (type === "PAUSE_UNDERPERFORMING_CAMPAIGN") {
    const roas = evidence.roas as number | null;
    const totalSpend = evidence.totalSpend as string | undefined;
    const attributedRevenue = evidence.attributedRevenue as string | null | undefined;
    return (
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">ROAS</dt>
          <dd className="font-medium">{roas !== null && roas !== undefined ? `${roas.toFixed(2)}x` : "Insufficient data"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total spend</dt>
          <dd className="font-medium">{totalSpend !== undefined ? formatCurrency(totalSpend) : "Insufficient data"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Attributed revenue</dt>
          <dd className="font-medium">
            {attributedRevenue !== null && attributedRevenue !== undefined ? formatCurrency(attributedRevenue) : "Insufficient data"}
          </dd>
        </div>
      </dl>
    );
  }

  if (type === "DISTRIBUTOR_EXPANSION_ADVISORY") {
    const score = evidence.opportunityScore as number | undefined;
    const classification = evidence.opportunityClassification as MarketOpportunityClassification | undefined;
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Score: {score ?? "—"}</span>
        {classification ? <ClassificationLabel classification={classification} /> : null}
      </div>
    );
  }

  // AT_RISK_FOLLOW_UP and any unrecognized type — real evidence, rendered generically.
  return <GenericEvidence evidence={evidence} />;
}

function confirmCopyForApproval(recommendation: OptimizationRecommendationDTO): { title: string; description: string } {
  const { actionType, actionParams, targetLabel } = recommendation;
  if (actionType === "CREATE_FOLLOW_UP") {
    const dueDate = actionParams.dueDate as string | undefined;
    return {
      title: "Approve this recommendation?",
      description: `This will create a real follow-up for ${targetLabel}${dueDate ? `, due ${formatDate(dueDate)}` : ""}.`,
    };
  }
  if (actionType === "PAUSE_CAMPAIGN") {
    return {
      title: "Approve this recommendation?",
      description: `This will pause the real ad campaign "${targetLabel}".`,
    };
  }
  return {
    title: "Approve this recommendation?",
    description: "This will mark this recommendation as acknowledged (no other change).",
  };
}

function ExecutionOutcome({ recommendation }: { recommendation: OptimizationRecommendationDTO }) {
  const { status, executionResult, actionType, reviewedByUserName, reviewedAt } = recommendation;

  const reviewedLine = reviewedByUserName ? (
    <p className="text-xs text-muted-foreground">
      Reviewed by {reviewedByUserName}
      {reviewedAt ? ` on ${formatDate(reviewedAt)}` : ""}
    </p>
  ) : null;

  if (status === "REJECTED") {
    return <div className="space-y-1">{reviewedLine}</div>;
  }

  if (status === "EXECUTED") {
    const message =
      executionResult?.message ??
      (actionType === "CREATE_FOLLOW_UP" ? "Follow-up created." : actionType === "PAUSE_CAMPAIGN" ? "Campaign paused." : "Acknowledged.");
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          {message}
          {executionResult?.createdEntityId ? (
            <span className="ml-1 text-xs font-normal text-muted-foreground">(id: {executionResult.createdEntityId})</span>
          ) : null}
        </p>
        {reviewedLine}
      </div>
    );
  }

  if (status === "EXECUTION_FAILED") {
    return (
      <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
        <p className="text-sm font-medium text-destructive">
          Couldn&apos;t be applied: {executionResult?.message ?? "Unknown error."}
        </p>
        {reviewedLine}
      </div>
    );
  }

  return <div className="space-y-1">{reviewedLine}</div>;
}

export function RecommendationCard({ recommendation }: { recommendation: OptimizationRecommendationDTO }) {
  const { isAdmin, isManager } = usePermissions();
  const canManage = isAdmin || isManager;

  const [confirmApproveOpen, setConfirmApproveOpen] = React.useState(false);
  const approve = useApproveRecommendation();
  const reject = useRejectRecommendation();

  const href = targetHref(recommendation);
  const insightHeading = recommendation.narrativeMethod === "RULE_BASED" ? "Rule-based insight" : "AI insight";

  async function handleApprove() {
    try {
      const updated = await approve.mutateAsync(recommendation.id);
      setConfirmApproveOpen(false);
      if (updated.status === "EXECUTED") {
        toast({ title: "Recommendation approved and executed" });
      } else {
        toast({
          title: "Approved, but couldn't be applied",
          description: updated.executionResult?.message,
          variant: "destructive",
        });
      }
    } catch (err) {
      setConfirmApproveOpen(false);
      toast({
        title: "Couldn't approve recommendation",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleReject() {
    try {
      await reject.mutateAsync(recommendation.id);
      toast({ title: "Recommendation rejected" });
    } catch (err) {
      toast({
        title: "Couldn't reject recommendation",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const { title: confirmTitle, description: confirmDescription } = confirmCopyForApproval(recommendation);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{TYPE_LABELS[recommendation.type]}</Badge>
            <StatusBadge status={recommendation.status} />
          </div>
          <p className="font-medium">
            {href ? (
              <Link href={href} className="hover:underline">
                {recommendation.targetLabel}
              </Link>
            ) : (
              recommendation.targetLabel
            )}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Created {formatDate(recommendation.createdAt)}</p>
      </div>

      <Evidence recommendation={recommendation} />

      {recommendation.narrative ? (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{insightHeading}</h4>
            <MethodBadge method={recommendation.narrativeMethod} />
          </div>
          <p className="text-sm">{recommendation.narrative}</p>
        </div>
      ) : null}

      {recommendation.status === "PENDING" ? (
        canManage ? (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setConfirmApproveOpen(true)}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Approve
            </Button>
            <Button variant="outline" size="sm" onClick={handleReject} isLoading={reject.isPending}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Awaiting review by an admin or manager.</p>
        )
      ) : (
        <ExecutionOutcome recommendation={recommendation} />
      )}

      <ConfirmDialog
        open={confirmApproveOpen}
        onOpenChange={setConfirmApproveOpen}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel="Approve"
        destructive={false}
        isLoading={approve.isPending}
        onConfirm={handleApprove}
      />
    </div>
  );
}

export { TYPE_LABELS };
