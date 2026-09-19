"use client";

import * as React from "react";
import { Database } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFmsData } from "@/hooks/use-fms";
import { ApiError } from "@/lib/api-client";
import { formatNumber } from "@/lib/utils";

const PREVIEW_LIMIT = 10;

/**
 * Read-only preview of the FMS Google Sheet, fetched via our own backend
 * (GET /api/fms/data — never script.google.com directly; see
 * frontend/src/hooks/use-fms.ts). The sheet's real column headers are
 * unreliable (raw row numbers, stringified dates, decimal fractions,
 * "Column_N" placeholders — see backend/src/modules/fms/fms.client.ts), so
 * this table derives its columns dynamically from whatever keys the
 * returned rows actually carry, rather than assuming any fixed FMS schema.
 * No renaming, no KPI calculation, no normalization — raw values only.
 */
export function FmsDataCard() {
  const fms = useFmsData({ sheet: "FMS", limit: PREVIEW_LIMIT });

  const columns = React.useMemo(() => {
    if (!fms.data || !fms.data.configured) return [];
    const keys = new Set<string>();
    for (const row of fms.data.data) {
      for (const key of Object.keys(row)) keys.add(key);
    }
    return Array.from(keys);
  }, [fms.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4 text-primary" />
          FMS Data
        </CardTitle>
        <CardDescription>
          Read-only preview from the connected FMS Google Sheet. Raw values as received — columns are not yet mapped
          to business fields.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fms.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : fms.isError ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {fms.error instanceof ApiError
                ? fms.error.status === 401
                  ? "Your session has expired — please sign in again."
                  : fms.error.message
                : "Unable to load FMS data."}
            </p>
            <Button variant="outline" size="sm" onClick={() => fms.refetch()}>
              Try again
            </Button>
          </div>
        ) : !fms.data ? null : !fms.data.configured ? (
          <EmptyState icon={Database} title="FMS integration not configured" description={fms.data.message} />
        ) : fms.data.data.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No rows returned"
            description="The FMS sheet is connected, but this request returned zero rows."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">Connection:</span>
                <Badge variant="success">Connected</Badge>
              </span>
              <span>
                <span className="text-muted-foreground">Total rows:</span>{" "}
                <span className="font-medium">{formatNumber(fms.data.totalRows)}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Showing:</span>{" "}
                <span className="font-medium">{formatNumber(fms.data.count)}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Last updated:</span>{" "}
                <span className="font-medium">{new Date(fms.data.fetchedAt).toLocaleString("en-IN")}</span>
              </span>
              <Badge variant="outline">{fms.data.dataSourceType}</Badge>
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
                {fms.data.data.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => {
                      const value = row[col] ?? "";
                      return (
                        <TableCell key={col} className="max-w-[240px] truncate" title={value || undefined}>
                          {value || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
