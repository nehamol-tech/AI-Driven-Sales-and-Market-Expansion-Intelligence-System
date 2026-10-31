import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FmsDataResponseDTO } from "@ai-sales/shared";
import { FmsSheetView, deriveFmsColumns, toFmsViewState, type FmsViewState } from "@/components/fms/fms-sheet-view";
import { ApiError } from "@/lib/api-client";

/** Real "Data" sheet headers — workflow-step records, not customers or orders. */
const DATA_ROWS = [
  { "Unique Key": "K-0001", "Step Code": "S1", "टाइमस्टैम्प": "2026-04-01 11:38:21" },
  { "Unique Key": "K-0002", "Step Code": "S2", "टाइमस्टैम्प": "2026-04-01 12:02:10" },
];

const CONFIGURED: FmsDataResponseDTO = {
  configured: true,
  sheet: "Data",
  count: 2,
  totalRows: 4038,
  data: DATA_ROWS,
  fetchedAt: "2026-10-10T11:40:57.293Z",
  dataSourceType: "EXTERNAL_DATA",
};

const idle = { isLoading: false, isError: false, error: null, data: undefined };

function render(state: FmsViewState): string {
  return renderToStaticMarkup(<FmsSheetView state={state} onRetry={() => {}} />);
}

describe("toFmsViewState", () => {
  it("is loading while the query is in flight", () => {
    expect(toFmsViewState({ ...idle, isLoading: true })).toEqual({ kind: "loading" });
  });

  it("maps a 401 ApiError to unauthenticated", () => {
    const state = toFmsViewState({ ...idle, isError: true, error: new ApiError(401, "Authentication required") });
    expect(state).toEqual({ kind: "unauthenticated" });
  });

  it("maps other API errors (e.g. 502 from the Apps Script) to error with the server's message", () => {
    const state = toFmsViewState({ ...idle, isError: true, error: new ApiError(502, "Failed to fetch data from the FMS API") });
    expect(state).toEqual({ kind: "error", message: "Failed to fetch data from the FMS API" });
  });

  it("uses a generic message for non-API errors", () => {
    expect(toFmsViewState({ ...idle, isError: true, error: new Error("boom") })).toEqual({
      kind: "error",
      message: "Unable to load FMS data.",
    });
  });

  it("maps configured:false to unconfigured", () => {
    const state = toFmsViewState({ ...idle, data: { configured: false, message: "Set FMS_API_URL to enable it." } });
    expect(state).toEqual({ kind: "unconfigured", message: "Set FMS_API_URL to enable it." });
  });

  it("maps zero rows to empty", () => {
    const state = toFmsViewState({ ...idle, data: { ...CONFIGURED, count: 0, data: [] } as FmsDataResponseDTO });
    expect(state).toEqual({ kind: "empty", sheet: "Data" });
  });

  it("maps rows to data", () => {
    expect(toFmsViewState({ ...idle, data: CONFIGURED })).toEqual({ kind: "data", data: CONFIGURED });
  });
});

describe("deriveFmsColumns", () => {
  it("uses the sheet's own headers in first-seen order, including non-Latin headers", () => {
    expect(deriveFmsColumns(DATA_ROWS)).toEqual(["Unique Key", "Step Code", "टाइमस्टैम्प"]);
  });

  it("includes keys that only appear on later rows, without duplicates", () => {
    expect(deriveFmsColumns([{ A: "1" }, { A: "2", B: "3" }])).toEqual(["A", "B"]);
  });

  it("returns no columns for no rows", () => {
    expect(deriveFmsColumns([])).toEqual([]);
  });
});

describe("FmsSheetView", () => {
  it("renders the returned headers and every cell value dynamically", () => {
    const html = render({ kind: "data", data: CONFIGURED as Extract<FmsDataResponseDTO, { configured: true }> });
    for (const header of ["Unique Key", "Step Code", "टाइमस्टैम्प"]) expect(html).toContain(`>${header}</th>`);
    for (const row of DATA_ROWS) for (const value of Object.values(row)) expect(html).toContain(value);
    expect(html).toContain("4,038");
    expect(html).toContain("Read-only");
  });

  it("shows numeric cells (including 0) rather than a blank placeholder", () => {
    const rows = [{ Count: 0, Amount: 1250 }] as unknown as typeof DATA_ROWS;
    const html = render({ kind: "data", data: { ...CONFIGURED, count: 1, data: rows } as Extract<FmsDataResponseDTO, { configured: true }> });
    expect(html).toMatch(/>0<\/td>/);
    expect(html).toMatch(/>1250<\/td>/);
  });

  it("does not present workflow steps as sales data or offer any write action", () => {
    const html = render({ kind: "data", data: CONFIGURED as Extract<FmsDataResponseDTO, { configured: true }> });
    const visibleText = html.replace(/<[^>]+>/g, " ");
    expect(visibleText).not.toMatch(/order|customer|revenue|import|sync|delete|save/i);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("renders a sign-in link when unauthenticated", () => {
    const html = render({ kind: "unauthenticated" });
    expect(html).toContain("Sign in required");
    expect(html).toContain('href="/login"');
  });

  it("renders the error message with a retry button", () => {
    const html = render({ kind: "error", message: "Failed to fetch data from the FMS API" });
    expect(html).toContain("Failed to fetch data from the FMS API");
    expect(html).toContain("Try again");
  });

  it("renders the unconfigured, empty and loading states", () => {
    expect(render({ kind: "unconfigured", message: "Set FMS_API_URL to enable it." })).toContain("FMS integration not configured");
    expect(render({ kind: "empty", sheet: "Data" })).toContain("No rows returned");
    expect(render({ kind: "loading" })).toContain('aria-busy="true"');
  });
});
