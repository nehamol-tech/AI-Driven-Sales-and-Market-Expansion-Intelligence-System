import { wholeTabRange, type CellValue, type GoogleSheetsReadOnlyClient } from "./google-sheets.client.js";

/**
 * Builds a catalogue of EVERY tab in the spreadsheet, discovered dynamically
 * through the read-only Sheets client — structure only (sizes, header row,
 * columns, value types), plus a likely purpose and a proposed database
 * mapping for review. Reads only; writes nothing anywhere.
 */

export type SheetCategory = "sales_orders" | "payments" | "customers" | "dispatch_workflow" | "workflow_events" | "form_responses" | "report" | "config" | "empty" | "other";

export interface CatalogColumn {
  index: number;
  /** The header text, or "Column_<n>" when the header cell is blank. */
  name: string;
  blankHeader: boolean;
  filled: number;
  types: { number: number; date: number; text: number; boolean: number };
  distinct: number;
}

export interface CatalogTab {
  title: string;
  index: number;
  hidden: boolean;
  gridRows: number;
  gridColumns: number;
  /** Last row (1-based) that has any value; 0 when empty. */
  usedRows: number;
  usedColumns: number;
  /** 1-based row of the detected header, or null for an empty tab. */
  headerRow: number | null;
  dataRows: number;
  nonBlankDataRows: number;
  columns: CatalogColumn[];
  duplicateHeaders: string[];
  category: SheetCategory;
  purpose: string;
  /** Shape of the first data row, values masked (no customer data). */
  sampleShape: string[];
}

export interface SheetCatalog {
  spreadsheetId: string;
  title: string;
  timeZone?: string;
  tabs: CatalogTab[];
}

const DATE_LIKE = /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})([ T]\d{1,2}:\d{2}(:\d{2})?)?$/;
const TIME_LIKE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const HEADER_SEARCH_ROWS = 15;

function isBlank(v: CellValue | undefined): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function kindOf(v: CellValue): keyof CatalogColumn["types"] {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  const s = v.trim();
  return DATE_LIKE.test(s) || TIME_LIKE.test(s) ? "date" : "text";
}

/** Masks a value to its shape — never its content. */
export function maskCell(v: CellValue | undefined): string {
  if (isBlank(v)) return "";
  const kind = kindOf(v as CellValue);
  if (kind !== "text") return `<${kind}>`;
  const s = String(v);
  if (/@/.test(s)) return "<email>";
  if (/^https?:\/\//i.test(s)) return "<url>";
  return `<text:${s.length}>`;
}

/**
 * The header row: among the first rows, the one with the most non-blank,
 * non-numeric, non-date cells (labels); earliest wins a tie. Handles tabs
 * whose real header sits below a title/notes block (e.g. FMS, row 6).
 */
export function detectHeaderRow(rows: CellValue[][]): number | null {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i++) {
    const score = (rows[i] ?? []).filter((v) => !isBlank(v) && kindOf(v) === "text").length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best === -1 ? null : best;
}

const has = (headers: string[], ...patterns: RegExp[]) => patterns.every((p) => headers.some((h) => p.test(h)));

/** Likely purpose from tab name and column names. A heuristic for review, not a rule. */
export function classifyTab(title: string, headers: string[], dataRows: number): { category: SheetCategory; purpose: string } {
  const h = headers.map((x) => x.toLowerCase());
  const t = title.toLowerCase();
  if (dataRows === 0) return { category: "empty", purpose: "No data" };
  if (has(h, /planned/, /actual/) || (has(h, /bill no/) && h.filter((x) => /status/.test(x)).length >= 2)) {
    return { category: "dispatch_workflow", purpose: "Order fulfilment tracker (planned/actual/status per workflow step)" };
  }
  if (has(h, /balance|due/, /payment|paid|received/)) return { category: "payments", purpose: "Receivables per bill (due, received, balance, status)" };
  if (has(h, /payment/, /bill no/)) return { category: "payments", purpose: "Payment receipts / follow-up log" };
  if (has(h, /bill no/, /bill amount|amount/, /customer/)) {
    return /form|response/.test(t)
      ? { category: "form_responses", purpose: "Order form responses (one row per bill)" }
      : { category: "sales_orders", purpose: "Order / sales register (one row per bill)" };
  }
  if (has(h, /customer/) && has(h, /credit|code/)) return { category: "customers", purpose: "Customer master (credit terms, customer codes)" };
  if (has(h, /step/) && has(h, /टाइमस्टैम्प|timestamp/)) return { category: "workflow_events", purpose: "Workflow step-completion log" };
  if (has(h, /match|check/) || /check/.test(t)) return { category: "report", purpose: "Derived check / reconciliation report" };
  if (/config|setup|format|holiday|email|directory/.test(t) || dataRows <= 10) return { category: "config", purpose: "Configuration / reference data" };
  return { category: "other", purpose: "Unclassified — needs review" };
}

export function profileTab(props: { title: string; index: number; hidden?: boolean; gridRows: number; gridColumns: number }, rows: CellValue[][]): CatalogTab {
  let usedRows = 0;
  let usedColumns = 0;
  rows.forEach((row, i) => {
    const lastFilled = row.reduce<number>((last, v, j) => (isBlank(v) ? last : j + 1), 0);
    if (lastFilled > 0) usedRows = i + 1;
    usedColumns = Math.max(usedColumns, lastFilled);
  });

  const headerIndex = detectHeaderRow(rows);
  const headerCells = headerIndex === null ? [] : rows[headerIndex];
  const data = headerIndex === null ? [] : rows.slice(headerIndex + 1, usedRows);
  const nonBlank = data.filter((r) => r.some((v) => !isBlank(v)));

  const columns: CatalogColumn[] = [];
  for (let c = 0; c < usedColumns; c++) {
    const raw = headerCells[c];
    const blankHeader = isBlank(raw);
    const values = nonBlank.map((r) => r[c]).filter((v): v is CellValue => !isBlank(v));
    const types = { number: 0, date: 0, text: 0, boolean: 0 };
    values.forEach((v) => (types[kindOf(v)] += 1));
    columns.push({ index: c, name: blankHeader ? `Column_${c + 1}` : String(raw).trim(), blankHeader, filled: values.length, types, distinct: new Set(values.map(String)).size });
  }
  const names = columns.filter((c) => !c.blankHeader).map((c) => c.name);
  const duplicateHeaders = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  const { category, purpose } = classifyTab(props.title, names, nonBlank.length);

  return {
    title: props.title,
    index: props.index,
    hidden: props.hidden ?? false,
    gridRows: props.gridRows,
    gridColumns: props.gridColumns,
    usedRows,
    usedColumns,
    headerRow: headerIndex === null ? null : headerIndex + 1,
    dataRows: data.length,
    nonBlankDataRows: nonBlank.length,
    columns,
    duplicateHeaders,
    category,
    purpose,
    sampleShape: (nonBlank[0] ?? []).slice(0, usedColumns).map(maskCell),
  };
}

/** Lists every tab and profiles it. Tabs are read in small batches. */
export async function buildSheetCatalog(client: GoogleSheetsReadOnlyClient, batchSize = 4): Promise<SheetCatalog> {
  const meta = await client.getSpreadsheet();
  const grids = meta.sheets.map((s) => s.properties).filter((p) => (p.sheetType ?? "GRID") === "GRID");
  const tabs: CatalogTab[] = [];
  for (let i = 0; i < grids.length; i += batchSize) {
    const batch = grids.slice(i, i + batchSize);
    const values = await client.getValues(batch.map((p) => wholeTabRange(p.title)));
    batch.forEach((p, j) =>
      tabs.push(
        profileTab(
          { title: p.title, index: p.index, hidden: p.hidden, gridRows: p.gridProperties?.rowCount ?? 0, gridColumns: p.gridProperties?.columnCount ?? 0 },
          values[j],
        ),
      ),
    );
  }
  return { spreadsheetId: meta.spreadsheetId, title: meta.properties.title, timeZone: meta.properties.timeZone, tabs: tabs.sort((a, b) => a.index - b.index) };
}
