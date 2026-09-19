"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileUp, XCircle, UploadCloud } from "lucide-react";
import { useImportBatchStatus, useImportSalesCsv } from "@/hooks/use-sales";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export default function SalesImportPage() {
  const [file, setFile] = React.useState<File | null>(null);
  const [batchId, setBatchId] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const uploadCsv = useImportSalesCsv();
  const { data: status, isError: statusError } = useImportBatchStatus(batchId, Boolean(batchId));

  async function handleUpload() {
    if (!file) return;
    try {
      const result = await uploadCsv.mutateAsync(file);
      setBatchId(result.batchId);
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof ApiError ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  function reset() {
    setFile(null);
    setBatchId(null);
  }

  function onFileChosen(f: File | null) {
    if (f && !f.name.toLowerCase().endsWith(".csv")) {
      toast({ title: "Please choose a .csv file", variant: "destructive" });
      return;
    }
    setFile(f);
  }

  const isDone = status?.status === "COMPLETED" || status?.status === "FAILED";
  const errorRows = Array.isArray(status?.errors) ? (status?.errors as unknown[]) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/sales"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import sales from CSV</h1>
          <p className="text-sm text-muted-foreground">
            Upload historical sales data in bulk.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose a file</CardTitle>
          <CardDescription>
            CSV with columns matching your sales fields (date, customerName, quantity,
            orderValue, and optional product/state/city/industry/salesperson references).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label
            htmlFor="csv-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) onFileChosen(dropped);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center transition-colors",
              dragOver && "border-primary bg-accent"
            )}
          >
            <UploadCloud className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {file ? file.name : "Click to choose a file or drag it here"}
            </p>
            <p className="text-xs text-muted-foreground">CSV files only</p>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
              disabled={Boolean(batchId)}
            />
          </label>

          {!batchId ? (
            <Button
              className="w-full"
              onClick={handleUpload}
              disabled={!file}
              isLoading={uploadCsv.isPending}
            >
              <FileUp className="mr-1.5 h-4 w-4" />
              Upload and import
            </Button>
          ) : (
            <Button variant="outline" className="w-full" onClick={reset}>
              Import another file
            </Button>
          )}
        </CardContent>
      </Card>

      {batchId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Import progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusError ? (
              <p className="text-sm text-destructive">
                Couldn&apos;t check import status. The import may still be running on the
                server — try refreshing the Sales page shortly.
              </p>
            ) : !status ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                Starting import...
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {status.status === "COMPLETED" ? (
                    <Badge variant="success">Completed</Badge>
                  ) : status.status === "FAILED" ? (
                    <Badge variant="destructive">Failed</Badge>
                  ) : (
                    <Badge variant="secondary">{status.status}</Badge>
                  )}
                  {!isDone ? (
                    <span className="text-xs text-muted-foreground">
                      Processing... this updates automatically.
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="rounded-md border border-border p-3">
                    <div className="text-xl font-semibold">{status.totalRows}</div>
                    <div className="text-xs text-muted-foreground">Total rows</div>
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-center gap-1 text-xl font-semibold text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" />
                      {status.successRows}
                    </div>
                    <div className="text-xs text-muted-foreground">Succeeded</div>
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-center gap-1 text-xl font-semibold text-destructive">
                      <XCircle className="h-4 w-4" />
                      {status.failedRows}
                    </div>
                    <div className="text-xs text-muted-foreground">Failed</div>
                  </div>
                </div>

                {isDone && status.failedRows > 0 && errorRows.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Row errors</p>
                    <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                      <table className="w-full text-xs">
                        <tbody>
                          {errorRows.map((rowError, idx) => (
                            <tr key={idx} className="border-b border-border last:border-0">
                              <td className="p-2 align-top text-muted-foreground">
                                {typeof rowError === "object" && rowError !== null
                                  ? JSON.stringify(rowError)
                                  : String(rowError)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {isDone ? (
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" asChild>
                      <Link href="/sales">View sales</Link>
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
