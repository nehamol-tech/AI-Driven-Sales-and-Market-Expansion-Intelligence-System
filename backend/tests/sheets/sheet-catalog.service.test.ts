import { describe, it, expect } from "vitest";
import { buildSheetCatalog, classifyTab, detectHeaderRow, maskCell, profileTab } from "../../src/modules/sheets/sheet-catalog.service.js";
import type { CellValue, GoogleSheetsReadOnlyClient } from "../../src/modules/sheets/google-sheets.client.js";

describe("detectHeaderRow", () => {
  it("finds a header below a title/notes block (FMS-style)", () => {
    const rows: CellValue[][] = [
      ["", "step1", "step2"],
      ["What", "Billing", "Loading"],
      ["Who", "Gopi", "Suresh"],
      ["When", 1, 2],
      ["", ""],
      ["Timestamp", "Bill No.", "Customer Name", "Bill Amount", "Planned", "Actual", "Status", "Planned", "Actual", "Status"],
      ["01/04/2026 11:38:21", 1, "x", 100, "01/04/2026", "01/04/2026", "Done", "", "", ""],
    ];
    expect(detectHeaderRow(rows)).toBe(5);
  });

  it("returns null for an empty tab", () => {
    expect(detectHeaderRow([])).toBeNull();
  });
});

describe("profileTab", () => {
  it("measures used size, names blank headers, flags duplicates and masks the sample", () => {
    const rows: CellValue[][] = [
      ["Bill No.", "Customer Name", "", "Bill Amount", "Customer Name"],
      [101, "Acme Stores", "note", 5000, "Acme Stores"],
      [],
      [102, "Beta", "", 700, "Beta"],
    ];
    const tab = profileTab({ title: "Form responses 2", index: 3, gridRows: 1000, gridColumns: 26 }, rows);
    expect(tab).toMatchObject({ usedRows: 4, usedColumns: 5, headerRow: 1, dataRows: 3, nonBlankDataRows: 2, duplicateHeaders: ["Customer Name"], category: "form_responses" });
    expect(tab.columns[2]).toMatchObject({ name: "Column_3", blankHeader: true, filled: 1 });
    expect(tab.columns[3].types.number).toBe(2);
    expect(tab.sampleShape).toEqual(["<number>", "<text:11>", "<text:4>", "<number>", "<text:11>"]);
    expect(JSON.stringify(tab)).not.toContain("Acme");
  });
});

describe("classifyTab", () => {
  it.each([
    ["Account_Process", ["Date", "Bill No.", "Customer Name", "Bill Amount", "Payment Received", "Balance Due", "Final Status"], "payments"],
    ["AP Form", ["टाइमस्टैम्प", "Bill No.", "Customer Name", "Payment Received", "Status"], "payments"],
    ["FMS Response", ["टाइमस्टैम्प", "Bill No.", "Customer Name", "Product & Qty", "Bill Amount"], "form_responses"],
    ["Orders", ["Bill No.", "Customer Name", "Bill Amount"], "sales_orders"],
    ["Customer_Database", ["Customer Name", "Credit Days", "Code number"], "customers"],
    ["FMS", ["Timestamp", "Bill No.", "Planned", "Actual", "Status"], "dispatch_workflow"],
    ["Data", ["Unique Key", "Step Code", "टाइमस्टैम्प"], "workflow_events"],
    ["Data_Check", ["Response Bill", "FMS Bill", "Customer Match"], "report"],
    ["form_config", ["Form Name", "Prefilled URL"], "config"],
  ])("%s → %s", (title, headers, category) => {
    expect(classifyTab(title, headers, 50).category).toBe(category);
  });

  it("an empty tab is empty", () => {
    expect(classifyTab("Holidays", [], 0).category).toBe("empty");
  });
});

describe("maskCell", () => {
  it("never returns cell content", () => {
    expect(["person@example.com", "https://x.test", "Acme", 12, "01/04/2026", true, ""].map((v) => maskCell(v as CellValue))).toEqual([
      "<email>",
      "<url>",
      "<text:4>",
      "<number>",
      "<date>",
      "<boolean>",
      "",
    ]);
  });
});

describe("buildSheetCatalog", () => {
  it("catalogues every tab returned by the spreadsheet, in order, reading values in batches", async () => {
    const tabs = ["FMS Response", "Holidays", "AP Form", "Setup", "Data"];
    const batches: string[][] = [];
    const client = {
      getSpreadsheet: async () => ({
        spreadsheetId: "id1",
        properties: { title: "AI sales agent sale 26-27", timeZone: "Asia/Kolkata" },
        sheets: [
          ...tabs.map((title, index) => ({ properties: { sheetId: index, title, index, gridProperties: { rowCount: 1000, columnCount: 26 } } })),
          { properties: { sheetId: 99, title: "Chart1", index: 5, sheetType: "OBJECT" } },
        ],
      }),
      getValues: async (ranges: string[]) => {
        batches.push(ranges);
        return ranges.map((r) => (r === "'Holidays'" || r === "'Setup'" ? [] : [["Bill No.", "Customer Name", "Bill Amount"], [1, "x", 5]]));
      },
    } as unknown as GoogleSheetsReadOnlyClient;

    const catalog = await buildSheetCatalog(client, 2);

    expect(catalog).toMatchObject({ spreadsheetId: "id1", title: "AI sales agent sale 26-27", timeZone: "Asia/Kolkata" });
    expect(catalog.tabs.map((t) => t.title)).toEqual(tabs); // the chart tab is skipped
    expect(batches).toEqual([["'FMS Response'", "'Holidays'"], ["'AP Form'", "'Setup'"], ["'Data'"]]);
    expect(catalog.tabs.find((t) => t.title === "Holidays")).toMatchObject({ category: "empty", usedRows: 0, headerRow: null });
  });
});
