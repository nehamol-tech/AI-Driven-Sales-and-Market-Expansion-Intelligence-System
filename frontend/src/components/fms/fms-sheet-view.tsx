"use client";

import * as React from "react";
import Link from "next/link";
import { Database, Lock } from "lucide-react";
import type { FmsDataResponseDTO, FmsRawRow } from "@ai-sales/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFmsData } from "@/hooks/use-fms";
import { ApiError } from "@/lib/api-client";
import { formatNumber } from "@/lib/utils";

type ConfiguredFmsData = Extract<FmsDataResponseDTO, { configured: true }>;

export type FmsViewState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "empty"; sheet: string }
  | { kind: "data"; data: ConfiguredFmsData };

/** Collapses a React Query result for GET /api/fms/data into exactly one renderable state. */
export function toFmsViewState(query: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: FmsDataResponseDTO | undefined;
}): FmsViewState {
  if (query.isLoading) return { kind: "loading" };
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 401) return { kind: "unauthenticated" };
    return {
      kind: "error",
      message: query.error instanceof ApiError ? query.error.message : "Unable to load FMS data.",
    };
  }
  if (!query.data) return { kind: "loading" };
  if (!query.data.configured) return { kind: "unconfigured", message: query.data.message };
  if (query.data.data.length === 0) return { kind: "empty", sheet: query.data.sheet };
  return { kind: "data", data: query.data };
}

/**
 * Columns are whatever keys the returned rows actually carry, in first-seen
 * order — never a fixed schema. The FMS sheets' headers are owned by the
 * sheet itself (e.g. the "Data" sheet holds workflow-step records, not
 * orders), so nothing here renames, maps or interprets them.
 */
export function deriveFmsColumns(rows: FmsRawRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  return Array.from(keys);
}

/** Sheet cells can arrive as JSON numbers despite FmsRawRow's string type — display any value safely, keeping a real 0. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Pure presentation of one FmsViewState — no data fetching and no actions besides an optional retry. */
export function FmsSheetView({ state, onRetry }: { state: FmsViewState; onRetry?: () => void }) {
  switch (state.kind) {
    case "loading":
      return (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    case "unauthenticated":
      return (
        <EmptyState
          icon={Lock}
          title="Sign in required"
          description="Your session has expired or you are signed out. Sign in again to view FMS data."
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
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      );
    case "unconfigured":
      return <EmptyState icon={Database} title="FMS integration not configured" description={state.message} />;
    case "empty":
      return (
        <EmptyState
          icon={Database}
          title="No rows returned"
          description={`The "${state.sheet}" sheet is connected, but this request returned zero rows.`}
        />
      );
    case "data": {
      const { data } = state;
      const columns = deriveFmsColumns(data.data);
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">Sheet:</span>
              <Badge variant="outline">{data.sheet}</Badge>
            </span>
            <span>
              <span className="text-muted-foreground">Total rows:</span>{" "}
              <span className="font-medium">{formatNumber(data.totalRows)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Showing:</span>{" "}
              <span className="font-medium">{formatNumber(data.count)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Last updated:</span>{" "}
              <span className="font-medium">{new Date(data.fetchedAt).toLocaleString("en-IN")}</span>
            </span>
            <Badge variant="outline">Read-only</Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col} className="whitespace-nowrap">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((col) => {
                    const text = cellText(row[col]);
                    return (
                      <TableCell key={col} className="max-w-[240px] truncate" title={text || undefined}>
                        {text || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    }
  }
}

/**
 * Read-only card for one FMS sheet, fetched only through our backend
 * (GET /api/fms/data via useFmsData) — the browser never sees the Apps
 * Script URL.
 */
export function FmsSheetCard({
  sheet,
  limit,
  title,
  description,
}: {
  sheet: string;
  limit: number;
  title: string;
  description: string;
}) {
  const fms = useFmsData({ sheet, limit });
  const state = toFmsViewState(fms);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <FmsSheetView state={state} onRetry={() => fms.refetch()} />
      </CardContent>
    </Card>
  );
}
