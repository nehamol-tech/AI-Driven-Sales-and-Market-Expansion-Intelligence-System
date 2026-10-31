import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FmsFulfilmentResponseDTO, FmsFulfilmentStepDTO } from "@ai-sales/shared";
import { FulfilmentView, toFulfilmentViewState, type FulfilmentViewState } from "@/components/fms/fms-fulfilment-view";
import { ApiError } from "@/lib/api-client";

type Data = Extract<FmsFulfilmentResponseDTO, { configured: true }>;

const NAMES = ["Billing and Rechecking", "Material Shuffling/Loading", "Material Dispatch", "Customer Received", "Accounts Process"];

function step(n: number, overrides: Partial<FmsFulfilmentStepDTO> = {}): FmsFulfilmentStepDTO {
  return {
    step: n,
    code: `step${n}`,
    name: NAMES[n - 1],
    planned: "2026-04-01 10:00:00",
    actual: "",
    status: "",
    timeDelay: n === 5 ? null : "",
    issues: [{ field: "actual", issue: "missing" }],
    actualAfterPlanned: null,
    ...overrides,
  };
}

function data(overrides: Partial<Data> = {}): Data {
  return {
    configured: true,
    sheet: "FMS",
    fetchedAt: "2026-10-10T12:00:00.000Z",
    dataSourceType: "EXTERNAL_DATA",
    retrieval: { limit: 10000, rowsReturned: 10000, totalRowsReported: 50500, complete: true, reason: "ok" },
    headerRowIndex: 5,
    warnings: [],
    totals: { orders: 2, matched: 1, unmatched: 0, ambiguous: 1, nonOrderRows: 0, duplicateBillNos: 0 },
    stepSummary: NAMES.map((name, i) => ({
      step: i + 1,
      code: `step${i + 1}`,
      name,
      withActual: 1,
      withoutActual: 1,
      withRecordedDelay: 0,
      actualAfterPlanned: 1,
      malformed: 0,
    })),
    page: 1,
    pageSize: 25,
    totalPages: 1,
    orders: [
      {
        billNo: "4321",
        orderTimestamp: "2026-04-01 08:00:00",
        customerName: "Test Customer",
        salesRecord: { status: "matched", salesRecordId: "sr1", accountId: "a1", matchedBy: "bill_no" },
        steps: [
          step(1, { actual: "2026-04-01 09:00:00", status: "Done", issues: [], actualAfterPlanned: false }),
          step(2, { actual: "2026-04-01 11:30:00", timeDelay: "1:30", issues: [], actualAfterPlanned: true }),
          step(3, { actual: "#NUM!", issues: [{ field: "actual", issue: "sheet_error" }] }),
          step(4),
          step(5),
        ],
        stepsWithActual: 3,
      },
      {
        billNo: "4320",
        orderTimestamp: "2026-04-01 07:00:00",
        customerName: "",
        salesRecord: { status: "ambiguous", candidateCount: 2 },
        steps: [1, 2, 3, 4, 5].map((n) => step(n)),
        stepsWithActual: 0,
      },
    ],
    ...overrides,
  };
}

const idle = { isLoading: false, isError: false, error: null, data: undefined };
const render = (state: FulfilmentViewState) => renderToStaticMarkup(<FulfilmentView state={state} onRetry={() => {}} />);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("toFulfilmentViewState", () => {
  it("maps loading, 401, other errors, unconfigured, empty and data", () => {
    expect(toFulfilmentViewState({ ...idle, isLoading: true })).toEqual({ kind: "loading" });
    expect(toFulfilmentViewState({ ...idle, isError: true, error: new ApiError(401, "x") })).toEqual({ kind: "unauthenticated" });
    expect(toFulfilmentViewState({ ...idle, data: { configured: false, message: "not set" } })).toEqual({ kind: "unconfigured", message: "not set" });
    const empty = data({ totals: { ...data().totals, orders: 0 }, orders: [] });
    expect(toFulfilmentViewState({ ...idle, data: empty })).toEqual({ kind: "empty", data: empty });
    expect(toFulfilmentViewState({ ...idle, data: data() }).kind).toBe("data");
  });

  it("carries the backend's layout problems into the error state", () => {
    const error = new ApiError(502, "The FMS sheet's layout was not recognised", { problems: ['Required column "Bill No." not found.'] });
    expect(toFulfilmentViewState({ ...idle, isError: true, error })).toEqual({
      kind: "error",
      message: "The FMS sheet's layout was not recognised",
      problems: ['Required column "Bill No." not found.'],
    });
  });
});

describe("FulfilmentView", () => {
  it("renders all five steps with source values, recorded delay and the match status", () => {
    const html = render({ kind: "data", data: data() });
    const t = text(html);
    for (const name of NAMES) expect(t).toContain(name);
    expect(t).toContain("2026-04-01 09:00:00");
    expect(t).toContain("Status: Done");
    expect(t).toContain("Recorded delay: 1:30");
    expect(t).toContain("Matched");
    expect(t).toContain("Ambiguous (2)");
    expect(t).toContain("actual: Sheet error");
    expect(t).toContain("#NUM!");
  });

  it("describes timestamp order neutrally and never labels a step late", () => {
    const t = text(render({ kind: "data", data: data() }));
    expect(t).toContain("Actual is after planned");
    expect(t).not.toMatch(/\blate\b|overdue/i);
  });

  it("shows an incomplete-data notice when retrieval was cut off", () => {
    const html = render({
      kind: "data",
      data: data({ retrieval: { limit: 10000, rowsReturned: 10000, totalRowsReported: 50500, complete: false, reason: "Later orders may be missing." } }),
    });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("Incomplete data");
    expect(text(html)).toContain("Later orders may be missing.");
  });

  it("shows layout warnings", () => {
    const t = text(render({ kind: "data", data: data({ warnings: ['Step 5 (Accounts Process): headed "Time"'] }) }));
    expect(t).toContain('Step 5 (Accounts Process): headed "Time"');
  });

  it("offers no write actions — its only buttons are page navigation", () => {
    const html = render({ kind: "data", data: data() });
    expect(html).not.toContain("<form");
    const buttons = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1]).trim());
    expect(buttons).toEqual(["Previous", "Next"]);
  });

  it("renders the empty, unconfigured, error, sign-in and loading states", () => {
    expect(text(render({ kind: "empty", data: data({ orders: [] }) }))).toContain("No orders found");
    expect(text(render({ kind: "unconfigured", message: "Set FMS_API_URL." }))).toContain("FMS integration not configured");
    const err = text(render({ kind: "error", message: "The FMS sheet's layout was not recognised", problems: ["Missing Bill No."] }));
    expect(err).toContain("Missing Bill No.");
    expect(err).toContain("Try again");
    expect(render({ kind: "unauthenticated" })).toContain('href="/login"');
    expect(render({ kind: "loading" })).toContain('aria-busy="true"');
  });
});
