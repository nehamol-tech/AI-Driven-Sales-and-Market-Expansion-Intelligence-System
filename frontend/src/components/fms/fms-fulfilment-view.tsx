"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Lock, Truck } from "lucide-react";
import type { FmsFulfilmentResponseDTO, FmsFulfilmentStepDTO } from "@ai-sales/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFmsFulfilment } from "@/hooks/use-fms";
import { ApiError } from "@/lib/api-client";
import { formatNumber } from "@/lib/utils";

type FulfilmentData = Extract<FmsFulfilmentResponseDTO, { configured: true }>;

export type FulfilmentViewState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string; problems: string[] }
  | { kind: "unconfigured"; message: string }
  | { kind: "empty"; data: FulfilmentData }
  | { kind: "data"; data: FulfilmentData };

function layoutProblems(details: unknown): string[] {
  if (typeof details !== "object" || details === null) return [];
  const problems = (details as { problems?: unknown }).problems;
  return Array.isArray(problems) ? problems.filter((p): p is string => typeof p === "string") : [];
}

/** Collapses a React Query result for GET /api/fms/fulfilment into exactly one renderable state. */
export function toFulfilmentViewState(query: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: FmsFulfilmentResponseDTO | undefined;
}): FulfilmentViewState {
  if (query.isLoading) return { kind: "loading" };
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 401) return { kind: "unauthenticated" };
    if (query.error instanceof ApiError) {
      return { kind: "error", message: query.error.message, problems: layoutProblems(query.error.details) };
    }
    return { kind: "error", message: "Unable to load order fulfilment.", problems: [] };
  }
  if (!query.data) return { kind: "loading" };
  if (!query.data.configured) return { kind: "unconfigured", message: query.data.message };
  if (query.data.totals.orders === 0) return { kind: "empty", data: query.data };
  return { kind: "data", data: query.data };
}

const ISSUE_LABELS = { sheet_error: "Sheet error", unrecognised_format: "Unrecognised format" } as const;

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

/** Retrieval/layout notices shared by the empty and data states. */
function Notices({ data }: { data: FulfilmentData }) {
  if (data.retrieval.complete && data.warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {!data.retrieval.complete && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">Incomplete data</p>
            <p className="text-muted-foreground">{data.retrieval.reason}</p>
          </div>
        </div>
      )}
      {data.warnings.map((warning) => (
        <p key={warning} className="flex gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {warning}
        </p>
      ))}
    </div>
  );
}

function StepCell({ step }: { step: FmsFulfilmentStepDTO }) {
  const flagged = step.issues.filter((i) => i.issue !== "missing");
  return (
    <div className="space-y-0.5 text-xs">
      <div className="font-medium">{step.actual.trim() ? step.actual : <Dash />}</div>
      <div className="text-muted-foreground">Planned: {step.planned.trim() ? step.planned : "—"}</div>
      {step.status.trim() && <div className="text-muted-foreground">Status: {step.status}</div>}
      {step.timeDelay?.trim() && <div className="text-muted-foreground">Recorded delay: {step.timeDelay}</div>}
      {step.actualAfterPlanned && <div className="text-muted-foreground">Actual is after planned</div>}
      {flagged.map((i) => (
        <Badge key={i.field} variant="warning" className="mr-1">
          {i.field}: {ISSUE_LABELS[i.issue as keyof typeof ISSUE_LABELS]}
        </Badge>
      ))}
    </div>
  );
}

function MatchBadge({ match }: { match: FulfilmentData["orders"][number]["salesRecord"] }) {
  if (match.status === "matched") return <Badge variant="success">Matched</Badge>;
  if (match.status === "ambiguous") return <Badge variant="warning">Ambiguous ({match.candidateCount})</Badge>;
  return <Badge variant="outline">Not synced</Badge>;
}

/** Pure presentation of one FulfilmentViewState. The only controls are retry and page navigation. */
export function FulfilmentView({
  state,
  onRetry,
  onPageChange,
}: {
  state: FulfilmentViewState;
  onRetry?: () => void;
  onPageChange?: (page: number) => void;
}) {
  switch (state.kind) {
    case "loading":
      return (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-72" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    case "unauthenticated":
      return (
        <EmptyState
          icon={Lock}
          title="Sign in required"
          description="Your session has expired or you are signed out. Sign in again to view order fulfilment."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          }
        />
      );
    case "error":
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          {state.problems.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {state.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      );
    case "unconfigured":
      return <EmptyState icon={Truck} title="FMS integration not configured" description={state.message} />;
    case "empty":
      return (
        <div className="space-y-4">
          <Notices data={state.data} />
          <EmptyState
            icon={Truck}
            title="No orders found"
            description={`The "${state.data.sheet}" sheet was read, but no rows below its header have a Bill No.`}
          />
        </div>
      );
    case "data": {
      const { data } = state;
      return (
        <div className="space-y-4">
          <Notices data={data} />

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-muted-foreground">Orders:</span>{" "}
              <span className="font-medium">{formatNumber(data.totals.orders)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Matched to synced sales:</span>{" "}
              <span className="font-medium">{formatNumber(data.totals.matched)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Not synced:</span>{" "}
              <span className="font-medium">{formatNumber(data.totals.unmatched)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Ambiguous:</span>{" "}
              <span className="font-medium">{formatNumber(data.totals.ambiguous)}</span>
            </span>
            {data.totals.duplicateBillNos > 0 && (
              <span>
                <span className="text-muted-foreground">Repeated Bill Nos.:</span>{" "}
                <span className="font-medium">{formatNumber(data.totals.duplicateBillNos)}</span>
              </span>
            )}
            <span>
              <span className="text-muted-foreground">Last updated:</span>{" "}
              <span className="font-medium">{new Date(data.fetchedAt).toLocaleString("en-IN")}</span>
            </span>
            <Badge variant="outline">Read-only</Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Step</TableHead>
                <TableHead className="text-right">Actual recorded</TableHead>
                <TableHead className="text-right">No actual yet</TableHead>
                <TableHead className="text-right">Recorded delay</TableHead>
                <TableHead className="text-right">Actual after planned</TableHead>
                <TableHead className="text-right">Malformed cells</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.stepSummary.map((s) => (
                <TableRow key={s.step}>
                  <TableCell className="whitespace-nowrap">
                    {s.step}. {s.name}
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(s.withActual)}</TableCell>
                  <TableCell className="text-right">{formatNumber(s.withoutActual)}</TableCell>
                  <TableCell className="text-right">{formatNumber(s.withRecordedDelay)}</TableCell>
                  <TableCell className="text-right">{formatNumber(s.actualAfterPlanned)}</TableCell>
                  <TableCell className="text-right">{formatNumber(s.malformed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            &quot;Actual after planned&quot; compares the two timestamps as recorded in the sheet; it is not a lateness
            rule. &quot;Recorded delay&quot; counts only values entered in the sheet&apos;s own Time Delay column.
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Bill No.</TableHead>
                <TableHead className="whitespace-nowrap">Order time</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="whitespace-nowrap">Sales record</TableHead>
                {data.stepSummary.map((s) => (
                  <TableHead key={s.step} className="min-w-[170px]">
                    {s.step}. {s.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.orders.map((order, i) => (
                <TableRow key={`${order.billNo}-${order.orderTimestamp}-${i}`}>
                  <TableCell className="font-medium">{order.billNo}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{order.orderTimestamp.trim() ? order.orderTimestamp : <Dash />}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={order.customerName || undefined}>
                    {order.customerName.trim() ? order.customerName : <Dash />}
                  </TableCell>
                  <TableCell>
                    <MatchBadge match={order.salesRecord} />
                  </TableCell>
                  {order.steps.map((step) => (
                    <TableCell key={step.step} className="align-top">
                      <StepCell step={step} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {data.page} of {data.totalPages} · newest first
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => onPageChange?.(data.page - 1)}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page >= data.totalPages}
                onClick={() => onPageChange?.(data.page + 1)}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      );
    }
  }
}

const PAGE_SIZE = 25;

/** Read-only fulfilment section for the /fms page, fetched only through our backend. */
export function FmsFulfilmentCard() {
  const [page, setPage] = React.useState(1);
  const fulfilment = useFmsFulfilment({ page, pageSize: PAGE_SIZE });
  const state = toFulfilmentViewState(fulfilment);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4 text-primary" />
          Order fulfilment
        </CardTitle>
        <CardDescription>
          The five workflow steps for each order in the FMS sheet, exactly as recorded there, matched to synced sales
          records by Bill No.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FulfilmentView state={state} onRetry={() => fulfilment.refetch()} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}
