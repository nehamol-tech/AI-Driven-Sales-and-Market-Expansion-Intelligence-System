"use client";

import * as React from "react";
import { ClipboardList } from "lucide-react";
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
 * The fixed set of raw columns to show, in display order — matches the
 * approved plan exactly. Read from each row by exact key name; no
 * renaming, and "Product and Qty" is shown exactly as received (not split
 * into separate product/quantity fields).
 */
const ORDER_COLUMNS = [
  "Bill No.",
  "Customer Name",
  "Product and Qty",
  "Bill Amount",
  "Order Taken",
  "Dispatched By",
  "Dispatched Date",
  "PDC Cheque Date",
] as const;

/** Some cells on this sheet (e.g. "Bill No.", "Bill Amount") come back as JSON numbers rather than strings — stringify safely for display without touching the shared FmsRawRow type or any parsing logic. */
function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

/**
 * Read-only preview of the "Form responses 2" FMS sheet tab — the actual
 * customer/product order log, as opposed to the FMS tab's workflow-step
 * tracking rows shown in FmsDataCard. Same backend endpoint
 * (GET /api/fms/data), just a different `sheet` query param; no backend,
 * Apps Script, or FmsDataCard change involved.
 */
export function CustomerProductOrdersCard() {
  const fms = useFmsData({ sheet: "Form responses 2", limit: PREVIEW_LIMIT });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4 text-primary" />
          Customer &amp; Product Orders
        </CardTitle>
        <CardDescription>
          Read-only preview from the FMS &quot;Form responses 2&quot; sheet. Raw values as received — &quot;Product and
          Qty&quot; is shown exactly as entered, not split into separate fields.
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
                : "Unable to load order data."}
            </p>
            <Button variant="outline" size="sm" onClick={() => fms.refetch()}>
              Try again
            </Button>
          </div>
        ) : !fms.data ? null : !fms.data.configured ? (
          <EmptyState icon={ClipboardList} title="FMS integration not configured" description={fms.data.message} />
        ) : fms.data.data.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No orders returned"
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
                  {ORDER_COLUMNS.map((col) => (
                    <TableHead key={col} className="whitespace-nowrap">
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {fms.data.data.map((row, i) => (
                  <TableRow key={i}>
                    {ORDER_COLUMNS.map((col) => {
                      const value = displayValue((row as Record<string, unknown>)[col]);
                      return (
                        <TableCell key={col} className="max-w-[240px] truncate whitespace-pre-line" title={value || undefined}>
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
