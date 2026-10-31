/**
 * READ-ONLY: prints a catalogue of every tab in the spreadsheet and a
 * proposed database mapping. Uses the Sheets API with the
 * spreadsheets.readonly scope only. Writes nothing — not to Google, not to
 * the database, not to disk.
 *
 *   GOOGLE_SHEETS_SPREADSHEET_ID=<id> GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY=<path to key.json> npx tsx scripts/sheet-catalog.ts [--json]
 */
import "dotenv/config";
import { GoogleSheetsReadOnlyClient, loadServiceAccountKey } from "../src/modules/sheets/google-sheets.client.js";
import { buildSheetCatalog, type CatalogTab } from "../src/modules/sheets/sheet-catalog.service.js";

/** Proposed target for each kind of tab — for review only, nothing is created. */
function proposedMapping(tab: CatalogTab): string {
  const byTitle: Record<string, string> = {
    "FMS Response": "SalesRecord + Account (EXISTING sync: insert/update/cancel/renumber)",
    "Form responses 2": "SalesRecord (existing manual /sync; superseded by FMS Response)",
    FMS: "NEW FulfilmentStep per bill × step — or keep reading live (Order Fulfilment)",
    Data: "NEW FulfilmentEvent (step-completion log) — or raw snapshot only",
    Account_Process: "NEW Receivable per bill (linked to SalesRecord) — Overdue reads it live today",
    "AP Form": "NEW PaymentEvent (receipts / follow-ups per bill)",
    Customer_Database: "Account: NEW customerCode + creditDays fields",
    "Doer Emails": "Raw snapshot only — contains staff emails (needs approval)",
  };
  if (byTitle[tab.title]) return byTitle[tab.title];
  switch (tab.category) {
    case "report":
      return "Raw snapshot only (derived from other tabs)";
    case "config":
    case "empty":
      return "Raw snapshot only";
    default:
      return `Raw snapshot; typed mapping to be decided (${tab.category})`;
  }
}

async function main(): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const keySource = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
  if (!spreadsheetId || !keySource) {
    console.error("Set GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY (key file path or JSON).");
    process.exit(2);
  }
  const client = new GoogleSheetsReadOnlyClient(loadServiceAccountKey(keySource), spreadsheetId);
  const catalog = await buildSheetCatalog(client);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...catalog, tabs: catalog.tabs.map((t) => ({ ...t, proposedMapping: proposedMapping(t) })) }, null, 2));
    return;
  }
  console.log(`Spreadsheet: ${catalog.title} (${catalog.spreadsheetId})${catalog.timeZone ? `, time zone ${catalog.timeZone}` : ""}`);
  console.log(`Tabs: ${catalog.tabs.length}\n`);
  for (const t of catalog.tabs) {
    console.log(`#${t.index + 1} ${t.title}${t.hidden ? " (hidden)" : ""} — ${t.category}: ${t.purpose}`);
    console.log(`   grid ${t.gridRows}×${t.gridColumns}; used ${t.usedRows} rows × ${t.usedColumns} cols; header row ${t.headerRow ?? "-"}; data rows ${t.nonBlankDataRows} non-blank of ${t.dataRows}`);
    if (t.duplicateHeaders.length) console.log(`   duplicate headers: ${t.duplicateHeaders.join(", ")}`);
    const blank = t.columns.filter((c) => c.blankHeader && c.filled > 0).length;
    if (blank) console.log(`   ${blank} columns with data but no header`);
    for (const c of t.columns.filter((c) => !c.blankHeader || c.filled > 0)) {
      const kinds = Object.entries(c.types).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ");
      console.log(`   - ${c.name}: filled ${c.filled}${kinds ? ` (${kinds})` : ""}, distinct ${c.distinct}`);
    }
    console.log(`   sample shape: ${JSON.stringify(t.sampleShape)}`);
    console.log(`   proposed mapping: ${proposedMapping(t)}\n`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
