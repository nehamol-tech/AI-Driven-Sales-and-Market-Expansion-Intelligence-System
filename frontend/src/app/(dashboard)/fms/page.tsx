"use client";

import { FmsSheetCard } from "@/components/fms/fms-sheet-view";
import { FmsFulfilmentCard } from "@/components/fms/fms-fulfilment-view";

const DATA_SHEET_LIMIT = 20;

export default function FmsDataPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">FMS Data</h1>
        <p className="text-sm text-muted-foreground">
          Read-only view of the connected FMS Google Sheet. Nothing on this page changes the sheet or this app&apos;s
          records.
        </p>
      </div>

      <FmsFulfilmentCard />

      <FmsSheetCard
        sheet="Data"
        limit={DATA_SHEET_LIMIT}
        title="Workflow steps (Data sheet)"
        description={`The latest ${DATA_SHEET_LIMIT} workflow-step records exactly as the sheet returns them. Columns come from the sheet's own headers.`}
      />
    </div>
  );
}
