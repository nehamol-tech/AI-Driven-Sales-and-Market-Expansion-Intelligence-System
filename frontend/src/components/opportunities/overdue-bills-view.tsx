"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, IndianRupee, Lock, Package, Wallet } from "lucide-react";
import type { OverdueBillDetailEntryDTO, OverdueBillDetailResponseDTO, OverdueCustomerBillsResponseDTO } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/dashboard/metric-card";
import { sheetDate } from "@/components/opportunities/overdue-accounts-view";
import { useOverdueBillDetail, useOverdueCustomerBills } from "@/hooks/use-opportunities";
import { ApiError } from "@/lib/api-client";
import { formatCurrency, formatNumber } from "@/lib/utils";

/* -------------------------------------------------------------------------
 * Overdue → one customer's bills → one bill. Read-only views of the FMS
 * payment sheet ("Account_Process") through the existing backend.
 * ---------------------------------------------------------------------- */

type Loaded<T> = Extract<T, { configured: true }>;

export type FetchViewState<T> =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "notFound"; message: string }
  | { kind: "error"; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "data"; data: Loaded<T> };

export function toFetchViewState<T extends { configured: boolean }>(
  query: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined },
  fallbackError: string,
): FetchViewState<T> {
  if (query.isLoading) return { kind: "loading" };
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 401) return { kind: "unauthenticated" };
    if (query.error instanceof ApiError && query.error.status === 404) return { kind: "notFound", message: query.error.message };
    return { kind: "error", message: query.error instanceof ApiError ? query.error.message : fallbackError };
  }
  if (!query.data) return { kind: "loading" };
  if (!query.data.configured) return { kind: "unconfigured", message: (query.data as unknown as { message: string }).message };
  return { kind: "data", data: query.data as Loaded<T> };
}

const money = (value: string | null | undefined) => (value === null || value === undefined || value === "" ? "—" : formatCurrency(value));
const billHref = (billNo: string, accountId?: string) =>
  `/opportunities/overdue/bills/${encodeURIComponent(billNo)}${accountId ? `?account=${encodeURIComponent(accountId)}` : ""}`;

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={href}>
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        {label}
      </Link>
    </Button>
  );
}

function NonDataState<T>({ state, onRetry, what }: { state: Exclude<FetchViewState<T>, { kind: "data" }>; onRetry?: () => void; what: string }) {
  if (state.kind === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (state.kind === "unauthenticated") {
    return (
      <EmptyState
        icon={Lock}
        title="Sign in required"
        description={`Your session has expired or you are signed out. Sign in again to view ${what}.`}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        }
      />
    );
  }
  if (state.kind === "notFound") return <EmptyState icon={FileText} title="Nothing to show." description={state.message} />;
  if (state.kind === "unconfigured") return <EmptyState icon={Wallet} title="Payment data not connected" description={state.message} />;
  return (
    <EmptyState
      title={`Unable to load ${what} right now.`}
      description={state.message}
      action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined}
    />
  );
}

/* ---------------------------- customer's bills --------------------------- */

export function OverdueCustomerBillsList({
  state,
  onRetry,
  onPageChange,
}: {
  state: FetchViewState<OverdueCustomerBillsResponseDTO>;
  onRetry?: () => void;
  onPageChange?: (page: number) => void;
}) {
  if (state.kind !== "data") return <NonDataState state={state} onRetry={onRetry} what="this customer's overdue bills" />;
  const { data } = state;
  const { page, pageSize, total } = data.pagination;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Overdue bills" icon={FileText} metric={{ status: "ok", value: data.summary.overdueBills }} format={(v) => formatNumber(v)} />
        <MetricCard label="Outstanding on overdue bills" icon={IndianRupee} metric={{ status: "ok", value: data.summary.overdueAmount }} format={(v) => formatCurrency(v)} />
        <MetricCard label="Total outstanding (incl. pending)" icon={Wallet} metric={{ status: "ok", value: data.summary.totalOutstanding }} format={(v) => formatCurrency(v)} />
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Bill No.</TableHead>
              <TableHead className="whitespace-nowrap">Customer Name</TableHead>
              <TableHead className="whitespace-nowrap">Bill Date</TableHead>
              <TableHead className="whitespace-nowrap">Due Date</TableHead>
              <TableHead className="text-right whitespace-nowrap">Bill Amount</TableHead>
              <TableHead className="text-right whitespace-nowrap">Paid Amount</TableHead>
              <TableHead className="text-right whitespace-nowrap">Outstanding Amount</TableHead>
              <TableHead className="text-right whitespace-nowrap">Days Overdue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((bill) => (
              <TableRow key={`${bill.billNo}|${bill.billDate}`}>
                <TableCell className="font-medium">
                  <Link href={billHref(bill.billNo, data.account.accountId)} className="text-primary underline-offset-4 hover:underline" aria-label={`Open bill ${bill.billNo}`}>
                    {bill.billNo}
                  </Link>
                </TableCell>
                <TableCell>{bill.customerName || data.account.accountName}</TableCell>
                <TableCell className="whitespace-nowrap">{sheetDate(bill.billDate)}</TableCell>
                <TableCell className="whitespace-nowrap">{sheetDate(bill.dueDate)}</TableCell>
                <TableCell className="text-right">{money(bill.billAmount)}</TableCell>
                <TableCell className="text-right">{money(bill.paidAmount)}</TableCell>
                <TableCell className="text-right font-semibold">{money(bill.balanceDue)}</TableCell>
                <TableCell className="text-right">{bill.daysOverdue === null ? "—" : formatNumber(bill.daysOverdue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          Showing {formatNumber((page - 1) * pageSize + 1)}–{formatNumber(Math.min(page * pageSize, total))} of {formatNumber(total)} · Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        From the FMS payment sheet, as of {sheetDate(data.asOfDate)} (India time). Outstanding = Bill Amount − Paid Amount. Sheet read{" "}
        {new Date(data.fetchedAt).toLocaleString("en-IN")}.
      </p>
    </div>
  );
}

const BILLS_PAGE_SIZE = 25;

export function OverdueCustomerBillsPanel({ accountId }: { accountId: string }) {
  const [page, setPage] = React.useState(1);
  const query = useOverdueCustomerBills(accountId, { page, pageSize: BILLS_PAGE_SIZE });
  const state = toFetchViewState(query, "Unable to load this customer's overdue bills.");
  const data = state.kind === "data" ? state.data : undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href="/opportunities/overdue" label="Back to Overdue Accounts" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data ? data.account.accountName : "Overdue Bills"}</h1>
          <p className="text-sm text-muted-foreground">
            {data
              ? `${data.account.customerCode ? `Code ${data.account.customerCode} · ` : ""}${formatNumber(data.summary.overdueBills)} overdue bill${data.summary.overdueBills === 1 ? "" : "s"}`
              : "Loading…"}
          </p>
        </div>
      </div>
      <Card>
        <CardContent className="pt-6">
          <OverdueCustomerBillsList state={state} onRetry={() => query.refetch()} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}

/* --------------------------------- bill --------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children || "—"}</dd>
    </div>
  );
}

const statusVariant = (status: string) => (status === "Overdue" ? "destructive" : status === "Paid" ? "secondary" : "outline");
const sheetValue = (v: string) => (v && v !== "---" ? (/^\d{4}-\d{2}-\d{2}/.test(v) ? sheetDate(v) : v) : "—");

function BillEntry({ entry }: { entry: OverdueBillDetailEntryDTO }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Payment</CardTitle>
          {entry.finalStatus ? <Badge variant={statusVariant(entry.finalStatus) as "destructive" | "secondary" | "outline"}>{entry.finalStatus}</Badge> : null}
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="Customer Name">{entry.customerName}</Field>
            <Field label="Bill Date">{sheetDate(entry.billDate)}</Field>
            <Field label="Due Date">{sheetDate(entry.dueDate)}</Field>
            <Field label="Credit days">{entry.dueDays}</Field>
            <Field label="Bill Amount">{money(entry.billAmount)}</Field>
            <Field label="Paid Amount">{money(entry.paidAmount)}</Field>
            <Field label="Outstanding Amount">{money(entry.balanceDue)}</Field>
            <Field label="Days Overdue">{entry.daysOverdue === null ? "—" : formatNumber(entry.daysOverdue)}</Field>
            <Field label="Last follow-up">{sheetValue(entry.lastFollowUpDate)}</Field>
            <Field label="Follow-up stage">{sheetValue(entry.lastFollowUpStage)}</Field>
            <Field label="Follow-up mode">{sheetValue(entry.followUpMode)}</Field>
            <Field label="Payment received on">{sheetValue(entry.dateReceived)}</Field>
            {entry.customerCaption ? <Field label="Customer caption">{entry.customerCaption}</Field> : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Order
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entry.order ? (
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Order date">{sheetDate(entry.order.timestamp)}</Field>
              <Field label="Order taken by">{entry.order.orderTaken}</Field>
              <Field label="Dispatched by">{entry.order.dispatchedBy}</Field>
              <Field label="Dispatched on">{sheetDate(entry.order.dispatchedDate)}</Field>
              <Field label="Order value">
                {money(entry.order.orderValue)}
                {entry.order.cancelled ? <Badge variant="outline" className="ml-2">Cancelled</Badge> : null}
              </Field>
              <div className="col-span-2 md:col-span-3">
                <Field label="Product & Qty">
                  <span className="whitespace-pre-line font-normal">{entry.order.productAndQty}</span>
                </Field>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">This bill couldn&apos;t be linked to exactly one synced FMS order.</p>
          )}
          {entry.account ? (
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href={`/leads/accounts/${entry.account.accountId}`}>View Account: {entry.account.accountName}</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function OverdueBillDetail({ state, onRetry }: { state: FetchViewState<OverdueBillDetailResponseDTO>; onRetry?: () => void }) {
  if (state.kind !== "data") return <NonDataState state={state} onRetry={onRetry} what="this bill" />;
  const { data } = state;
  return (
    <div className="space-y-6">
      {data.entries.length > 1 ? (
        <p className="text-sm text-muted-foreground">The payment sheet has {data.entries.length} rows for Bill No. {data.billNo}; each is shown below.</p>
      ) : null}
      {data.entries.map((entry, i) => (
        <BillEntry key={`${entry.billDate}|${i}`} entry={entry} />
      ))}
      <p className="text-xs text-muted-foreground">
        From the FMS payment sheet and the synced FMS order, as of {sheetDate(data.asOfDate)} (India time). Sheet read {new Date(data.fetchedAt).toLocaleString("en-IN")}.
      </p>
    </div>
  );
}

export function OverdueBillDetailPanel({ billNo, fromAccountId }: { billNo: string; fromAccountId?: string }) {
  const query = useOverdueBillDetail(billNo);
  const state = toFetchViewState(query, "Unable to load this bill.");
  const accountName = state.kind === "data" ? state.data.entries.find((e) => e.account)?.account?.accountName : undefined;
  const backAccountId = fromAccountId ?? (state.kind === "data" ? state.data.entries.find((e) => e.account)?.account?.accountId : undefined);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {backAccountId ? (
            <BackLink href={`/opportunities/overdue/${encodeURIComponent(backAccountId)}`} label={accountName ? `Back to ${accountName}'s bills` : "Back to customer's bills"} />
          ) : null}
          <BackLink href="/opportunities/overdue" label="Back to Overdue Accounts" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bill No. {billNo}</h1>
          <p className="text-sm text-muted-foreground">{accountName ?? (state.kind === "loading" ? "Loading…" : "")}</p>
        </div>
      </div>
      <OverdueBillDetail state={state} onRetry={() => query.refetch()} />
    </div>
  );
}
