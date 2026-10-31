"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Lock, Search } from "lucide-react";
import type { DailyPriorityLevel, OpportunityAccountsResponseDTO, OpportunityCategory, OpportunityType } from "@ai-sales/shared";
import { OPPORTUNITY_TYPES } from "@ai-sales/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OpportunityTypeBadge } from "@/components/opportunities/opportunity-type-badge";
import { OPPORTUNITY_CATEGORY_LABELS } from "@/components/opportunities/opportunity-categories";
import { PriorityBadge } from "@/components/sales-agent/priority-badge";
import { useOpportunityAccounts } from "@/hooks/use-opportunities";
import { ApiError } from "@/lib/api-client";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";

export type OpportunityAccountsViewState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string }
  | { kind: "data"; data: OpportunityAccountsResponseDTO };

/** Collapses a React Query result for GET /sales-agent/opportunities/accounts into one renderable state. */
export function toOpportunityAccountsViewState(query: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: OpportunityAccountsResponseDTO | undefined;
}): OpportunityAccountsViewState {
  if (query.isLoading) return { kind: "loading" };
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 401) return { kind: "unauthenticated" };
    return { kind: "error", message: query.error instanceof ApiError ? query.error.message : "Unable to load these opportunities." };
  }
  if (!query.data) return { kind: "loading" };
  return { kind: "data", data: query.data };
}

/** "453 opportunities across 244 accounts", or "260 accounts" when every opportunity is a different account. */
export function describeCategoryTotal(data: Pick<OpportunityAccountsResponseDTO, "categoryTotal" | "categoryAccountCount">): string {
  const { categoryTotal, categoryAccountCount } = data;
  if (categoryTotal === categoryAccountCount) return `${formatNumber(categoryTotal)} account${categoryTotal === 1 ? "" : "s"}`;
  return `${formatNumber(categoryTotal)} opportunities across ${formatNumber(categoryAccountCount)} account${categoryAccountCount === 1 ? "" : "s"}`;
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

/** Pure presentation of the list area — header and filter controls live in OpportunityAccountsPanel. */
export function OpportunityAccountsList({
  category,
  state,
  search,
  onRetry,
  onPageChange,
}: {
  category: OpportunityCategory;
  state: OpportunityAccountsViewState;
  search?: string;
  onRetry?: () => void;
  onPageChange?: (page: number) => void;
}) {
  const label = OPPORTUNITY_CATEGORY_LABELS[category];

  if (state.kind === "loading") {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (state.kind === "unauthenticated") {
    return (
      <EmptyState
        icon={Lock}
        title="Sign in required"
        description="Your session has expired or you are signed out. Sign in again to view these opportunities."
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
        title="Unable to load these opportunities right now."
        description={state.message}
        action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined}
      />
    );
  }

  const { data } = state;
  if (data.categoryTotal === 0) {
    return (
      <EmptyState
        title={`No ${label} opportunities right now.`}
        description="None of your accounts currently meet this opportunity's rules. This list fills in automatically when they do."
      />
    );
  }
  if (data.pagination.total === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No matching opportunities."
        description={search ? `Nothing in ${label} matches "${search}". Try a different search or clear the filters.` : "Try clearing the filters."}
      />
    );
  }

  const { page, pageSize, total } = data.pagination;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Opportunity</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="text-right whitespace-nowrap">Total order value</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="whitespace-nowrap">Last order</TableHead>
              <TableHead className="text-right whitespace-nowrap">Days since</TableHead>
              <TableHead className="min-w-[260px]">Signal</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((row) => (
              <TableRow key={row.opportunityId}>
                <TableCell className="align-top">
                  <div className="font-medium">{row.accountName}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.industryName ?? "No industry"} · ID {row.accountId}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <OpportunityTypeBadge type={row.type} />
                  {row.productName ? <div className="mt-1 text-xs text-muted-foreground">{row.productName}</div> : null}
                </TableCell>
                <TableCell className="align-top">
                  <PriorityBadge priority={row.priority} />
                </TableCell>
                <TableCell className="text-right align-top">{formatCurrency(row.totalOrderValue)}</TableCell>
                <TableCell className="text-right align-top">{formatNumber(row.orderCount)}</TableCell>
                <TableCell className="whitespace-nowrap align-top">{row.lastOrderDate ? formatDate(row.lastOrderDate) : <Dash />}</TableCell>
                <TableCell className="text-right align-top">
                  {row.daysSinceLastOrder === null ? <Dash /> : formatNumber(row.daysSinceLastOrder)}
                </TableCell>
                <TableCell className="align-top text-xs">
                  {row.reason ? <p>{row.reason}</p> : null}
                  {row.evidence.length > 0 ? (
                    <p className="mt-1 text-muted-foreground">
                      {row.evidence.map((e) => `${e.label}: ${e.value}`).join(" · ")}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="align-top">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/leads/accounts/${row.accountId}`}>View Account</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)} · Page {page} of {totalPages}
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
    </div>
  );
}

const PAGE_SIZE = 25;
const ALL = "all";
const SEARCH_DEBOUNCE_MS = 300;
const TYPE_LABELS: Record<OpportunityType, string> = {
  REORDER: OPPORTUNITY_CATEGORY_LABELS.REORDER,
  AT_RISK: OPPORTUNITY_CATEGORY_LABELS.AT_RISK,
  CROSS_SELL: OPPORTUNITY_CATEGORY_LABELS.CROSS_SELL,
  HIGH_VALUE: OPPORTUNITY_CATEGORY_LABELS.HIGH_VALUE,
  REACTIVATION: OPPORTUNITY_CATEGORY_LABELS.REACTIVATION,
  GROWING_ACCOUNT: OPPORTUNITY_CATEGORY_LABELS.GROWING_ACCOUNT,
};

/** The full detail page body: back link, heading, search, filter, list, pagination. */
export function OpportunityAccountsPanel({ category }: { category: OpportunityCategory }) {
  const label = OPPORTUNITY_CATEGORY_LABELS[category];
  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<typeof ALL | OpportunityType>(ALL);
  const [priorityFilter, setPriorityFilter] = React.useState<typeof ALL | DailyPriorityLevel>(ALL);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const query = useOpportunityAccounts({
    category,
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    opportunityType: typeFilter === ALL ? undefined : typeFilter,
    priority: priorityFilter === ALL ? undefined : priorityFilter,
  });
  const state = toOpportunityAccountsViewState(query);
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
          <h1 className="text-2xl font-semibold tracking-tight">{label} Opportunities</h1>
          <p className="text-sm text-muted-foreground">
            {data ? (
              <>
                Showing {describeCategoryTotal(data)} · detected {new Date(data.generatedAt).toLocaleString("en-IN")}
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search account name, ID, industry…"
            className="pl-8"
            aria-label="Search accounts"
          />
        </div>
        {category === "HIGH_PRIORITY" ? (
          <Select
            value={typeFilter}
            onValueChange={(v) => {
              setTypeFilter(v as typeof typeFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {OPPORTUNITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select
            value={priorityFilter}
            onValueChange={(v) => {
              setPriorityFilter(v as typeof priorityFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All priorities</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <OpportunityAccountsList
            category={category}
            state={state}
            search={search}
            onRetry={() => query.refetch()}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
