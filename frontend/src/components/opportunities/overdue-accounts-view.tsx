"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, FileText, IndianRupee, Lock, Search, Users, Wallet, TrendingUp } from "lucide-react";
import type { OverdueAccountRowDTO, OverdueAccountsResponseDTO, OverdueAgeBucket, OverdueSort } from "@ai-sales/shared";
import { OVERDUE_AGE_BUCKETS } from "@ai-sales/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/dashboard/metric-card";
import { OpportunityTypeBadge } from "@/components/opportunities/opportunity-type-badge";
import { useOverdueAccounts } from "@/hooks/use-opportunities";
import { ApiError } from "@/lib/api-client";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type OverdueData = Extract<OverdueAccountsResponseDTO, { configured: true }>;

export type OverdueViewState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "data"; data: OverdueData };

export function toOverdueViewState(query: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: OverdueAccountsResponseDTO | undefined;
}): OverdueViewState {
  if (query.isLoading) return { kind: "loading" };
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 401) return { kind: "unauthenticated" };
    return { kind: "error", message: query.error instanceof ApiError ? query.error.message : "Unable to load overdue accounts." };
  }
  if (!query.data) return { kind: "loading" };
  if (!query.data.configured) return { kind: "unconfigured", message: query.data.message };
  return { kind: "data", data: query.data };
}

export const OVERDUE_AGE_LABELS: Record<OverdueAgeBucket, string> = {
  "1-30": "1–30 days overdue",
  "31-60": "31–60 days overdue",
  "61-90": "61–90 days overdue",
  "90+": "90+ days overdue",
};

export const OVERDUE_SORT_LABELS: Record<OverdueSort, string> = {
  amount: "Highest overdue amount",
  oldest: "Oldest overdue",
  recent: "Most recent overdue",
  name: "Customer name",
};

/** Sheet timestamps are "YYYY-MM-DD HH:MM:SS"; show the date part, or the raw value if it isn't in that form. */
export function sheetDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return value || "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
  );
}

function OverdueRow({ row }: { row: OverdueAccountRowDTO }) {
  const oldest = row.overdueBills[0];
  const others = row.overdueBills.slice(1);
  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-medium">{row.accountName}</div>
        <div className="text-xs text-muted-foreground">
          {row.customerCode ? `Code ${row.customerCode}` : "No customer code"} · ID {row.accountId}
        </div>
      </TableCell>
      <TableCell className="text-right align-top">{formatCurrency(row.totalOutstanding)}</TableCell>
      <TableCell className="text-right align-top font-semibold">{formatCurrency(row.overdueAmount)}</TableCell>
      <TableCell className="align-top text-xs">
        {oldest ? (
          <>
            <div className="font-medium">Bill {oldest.billNo}</div>
            <div className="text-muted-foreground">Billed {sheetDate(oldest.billDate)}</div>
            <div className="text-muted-foreground">Due {sheetDate(oldest.dueDate)}</div>
            {others.length > 0 ? (
              <div className="mt-1 text-muted-foreground" title={others.map((b) => b.billNo).join(", ")}>
                +{others.length} more overdue bill{others.length === 1 ? "" : "s"}: {others.map((b) => b.billNo).join(", ")}
              </div>
            ) : null}
          </>
        ) : null}
      </TableCell>
      <TableCell className="text-right align-top">{row.daysOverdue === null ? "—" : formatNumber(row.daysOverdue)}</TableCell>
      <TableCell className="align-top text-xs">{row.orderTakenBy.length ? row.orderTakenBy.join(", ") : "—"}</TableCell>
      <TableCell className="align-top">
        {row.opportunities.length ? (
          <div className="flex flex-wrap gap-1">
            {row.opportunities.map((o) => (
              <OpportunityTypeBadge key={o.type} type={o.type} className={cn(o.priority === "HIGH" && "ring-1 ring-destructive/40")} />
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild size="sm">
            <Link href={`/opportunities/overdue/${encodeURIComponent(row.accountId)}`}>
              <FileText className="mr-1.5 h-4 w-4" />
              View Bills ({formatNumber(row.overdueBills.length)})
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/leads/accounts/${row.accountId}`}>View Account</Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Pure presentation of the summary + list for one OverdueViewState. */
export function OverdueAccountsList({
  state,
  search,
  filtered,
  onRetry,
  onPageChange,
}: {
  state: OverdueViewState;
  search?: string;
  /** True when a search or age filter is active (changes the empty-state wording). */
  filtered?: boolean;
  onRetry?: () => void;
  onPageChange?: (page: number) => void;
}) {
  if (state.kind === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
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
        description="Your session has expired or you are signed out. Sign in again to view overdue accounts."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        }
      />
    );
  }
  if (state.kind === "error") {
    return (
      <EmptyState
        title="Unable to load overdue accounts right now."
        description={state.message}
        action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined}
      />
    );
  }
  if (state.kind === "unconfigured") {
    return <EmptyState icon={Wallet} title="Payment data not connected" description={state.message} />;
  }

  const { data } = state;
  const { summary } = data;
  const { page, pageSize, total } = data.pagination;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Overdue accounts" icon={Users} metric={{ status: "ok", value: summary.accounts }} format={(v) => formatNumber(v)} />
        <MetricCard label="Total overdue" icon={IndianRupee} metric={{ status: "ok", value: summary.totalOverdueAmount }} format={(v) => formatCurrency(v)} />
        <MetricCard label="Average overdue" icon={Wallet} metric={{ status: "ok", value: summary.averageOverdueAmount }} format={(v) => formatCurrency(v)} />
        <MetricCard label="Highest overdue" icon={TrendingUp} metric={{ status: "ok", value: summary.highestOverdueAmount }} format={(v) => formatCurrency(v)} />
      </div>

      {!data.retrieval.complete || data.unlinked.bills > 0 ? (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="space-y-1">
            {!data.retrieval.complete ? <p>{data.retrieval.reason}</p> : null}
            {data.unlinked.bills > 0 ? (
              <p>
                {formatNumber(data.unlinked.bills)} overdue bill{data.unlinked.bills === 1 ? "" : "s"} ({formatCurrency(data.unlinked.amount)}) couldn&apos;t be
                linked to a single account and {data.unlinked.bills === 1 ? "is" : "are"} not included above.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {summary.accounts === 0 ? (
        <EmptyState icon={Wallet} title="No overdue accounts." description="No bill in the payment sheet is currently marked Overdue." />
      ) : total === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching overdue accounts."
          description={search ? `Nothing matches "${search}". Try a different search or clear the filters.` : filtered ? "No accounts fall in this age range." : undefined}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Total outstanding</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Overdue amount</TableHead>
                  <TableHead className="whitespace-nowrap">Oldest overdue bill</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Days overdue</TableHead>
                  <TableHead className="whitespace-nowrap">Order taken by</TableHead>
                  <TableHead>Opportunity signals</TableHead>
                  <TableHead className="sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((row) => (
                  <OverdueRow key={row.accountId} row={row} />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Showing {formatNumber((page - 1) * pageSize + 1)}–{formatNumber(Math.min(page * pageSize, total))} of {formatNumber(total)} · Page {page} of{" "}
              {totalPages}
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
        </>
      )}
      <p className="text-xs text-muted-foreground">
        From the FMS payment sheet&apos;s own &quot;Overdue&quot; status, as of {sheetDate(data.asOfDate)} (India time). Days overdue count from each
        bill&apos;s due date; age filters use the account&apos;s oldest overdue bill. Sheet read {new Date(data.fetchedAt).toLocaleString("en-IN")}.
      </p>
    </div>
  );
}

const PAGE_SIZE = 25;
const ALL = "all";
const SEARCH_DEBOUNCE_MS = 300;

export function OverdueAccountsPanel() {
  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [age, setAge] = React.useState<typeof ALL | OverdueAgeBucket>(ALL);
  const [sort, setSort] = React.useState<OverdueSort>("amount");

  React.useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const query = useOverdueAccounts({ page, pageSize: PAGE_SIZE, search: search || undefined, age: age === ALL ? undefined : age, sort });
  const state = toOverdueViewState(query);
  const data = state.kind === "data" ? state.data : undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/opportunities">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Opportunity Center
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overdue Accounts</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${formatNumber(data.summary.accounts)} account${data.summary.accounts === 1 ? "" : "s"} with overdue payments` : "Loading…"}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, customer code, bill no…"
            className="pl-8"
            aria-label="Search overdue accounts"
          />
        </div>
        <Select
          value={age}
          onValueChange={(v) => {
            setAge(v as typeof age);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All overdue</SelectItem>
            {OVERDUE_AGE_BUCKETS.map((b) => (
              <SelectItem key={b} value={b}>
                {OVERDUE_AGE_LABELS[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(v) => {
            setSort(v as OverdueSort);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(OVERDUE_SORT_LABELS) as OverdueSort[]).map((s) => (
              <SelectItem key={s} value={s}>
                {OVERDUE_SORT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          <OverdueAccountsList
            state={state}
            search={search}
            filtered={age !== ALL || Boolean(search)}
            onRetry={() => query.refetch()}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** The Overdue card on the Opportunity Center — same endpoint as the detail page, so its count always matches. */
export function OverdueCard() {
  const query = useOverdueAccounts({ page: 1, pageSize: 1 });
  const state = toOverdueViewState(query);
  return (
    <Link
      href="/opportunities/overdue"
      aria-label="View overdue accounts"
      className="group block cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="transition-colors group-hover:border-primary/50 group-hover:bg-muted/40">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <Wallet className="h-5 w-5 text-destructive" />
            <div>
              <div className="text-sm font-medium text-muted-foreground">Overdue payments</div>
              {state.kind === "loading" ? (
                <div className="mt-1 h-7 w-40 animate-pulse rounded bg-muted" />
              ) : state.kind === "data" ? (
                <div className="text-2xl font-semibold tracking-tight">
                  {formatNumber(state.data.summary.accounts)} <span className="text-base font-normal text-muted-foreground">accounts</span>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {state.kind === "unconfigured" ? "Payment data not connected" : state.kind === "unauthenticated" ? "Sign in to view" : "Couldn't load right now"}
                </div>
              )}
            </div>
          </div>
          {state.kind === "data" ? (
            <div className="text-right text-sm">
              <div className="font-semibold">{formatCurrency(state.data.summary.totalOverdueAmount)}</div>
              <div className="text-muted-foreground">total overdue</div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
