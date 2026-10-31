import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OverdueBillDetailResponseDTO, OverdueCustomerBillsResponseDTO } from "@ai-sales/shared";
import { OverdueBillDetail, OverdueCustomerBillsList, toFetchViewState } from "@/components/opportunities/overdue-bills-view";
import { ApiError } from "@/lib/api-client";

type Bills = Extract<OverdueCustomerBillsResponseDTO, { configured: true }>;
type Detail = Extract<OverdueBillDetailResponseDTO, { configured: true }>;

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const bills = (overrides: Partial<Bills> = {}): Bills => ({
  configured: true,
  account: { accountId: "acc_1", accountName: "Alpha Stores", customerCode: "AD1" },
  summary: { overdueBills: 2, overdueAmount: "70000.00", totalOutstanding: "75000.00" },
  data: [
    { billNo: "2", customerName: "Alpha Stores", billDate: "2026-04-02 10:00:00", dueDate: "2026-07-01 10:00:00", daysOverdue: 118, billAmount: "21000.00", paidAmount: "1000.00", balanceDue: "20000.00" },
    { billNo: "1", customerName: "Alpha Stores", billDate: "2026-09-20 10:00:00", dueDate: "2026-10-20 10:00:00", daysOverdue: 7, billAmount: "51000.00", paidAmount: "1000.00", balanceDue: "50000.00" },
  ],
  pagination: { page: 1, pageSize: 25, total: 2 },
  asOfDate: "2026-10-27",
  fetchedAt: "2026-10-27T05:00:00.000Z",
  ...overrides,
});

const idle = { isLoading: false, isError: false, error: null, data: undefined };

describe("toFetchViewState", () => {
  it("maps loading, 401, 404, errors, unconfigured and data", () => {
    expect(toFetchViewState({ ...idle, isLoading: true }, "x")).toEqual({ kind: "loading" });
    expect(toFetchViewState({ ...idle, isError: true, error: new ApiError(401, "no") }, "x")).toEqual({ kind: "unauthenticated" });
    expect(toFetchViewState({ ...idle, isError: true, error: new ApiError(404, "This customer has no overdue bills.") }, "x")).toEqual({
      kind: "notFound",
      message: "This customer has no overdue bills.",
    });
    expect(toFetchViewState({ ...idle, isError: true, error: new ApiError(502, "Failed") }, "x")).toEqual({ kind: "error", message: "Failed" });
    expect(toFetchViewState({ ...idle, data: { configured: false, message: "not set" } as OverdueCustomerBillsResponseDTO }, "x")).toEqual({ kind: "unconfigured", message: "not set" });
    expect(toFetchViewState({ ...idle, data: bills() }, "x").kind).toBe("data");
  });
});

describe("OverdueCustomerBillsList", () => {
  it("shows every requested column for each bill, with the customer's totals", () => {
    const html = renderToStaticMarkup(<OverdueCustomerBillsList state={{ kind: "data", data: bills() }} />);
    const t = text(html);
    for (const h of ["Bill No.", "Customer Name", "Bill Date", "Due Date", "Bill Amount", "Paid Amount", "Outstanding Amount", "Days Overdue"]) expect(t).toContain(h);
    expect(t).toContain("Outstanding on overdue bills");
    expect(t).toContain("70,000");
    expect(t).toContain("75,000");
    expect(t).toContain("21,000"); // bill amount
    expect(t).toContain("1,000"); // paid
    expect(t).toContain("20,000"); // outstanding
    expect(t).toContain("01 Jul 2026");
    expect(t).toContain("118");
  });

  it("links every Bill No. to its bill details, remembering the customer", () => {
    const html = renderToStaticMarkup(<OverdueCustomerBillsList state={{ kind: "data", data: bills() }} />);
    expect(html).toContain('href="/opportunities/overdue/bills/2?account=acc_1"');
    expect(html).toContain('href="/opportunities/overdue/bills/1?account=acc_1"');
  });

  it("pages", () => {
    const t = text(renderToStaticMarkup(<OverdueCustomerBillsList state={{ kind: "data", data: bills({ pagination: { page: 2, pageSize: 25, total: 60 } }) }} />));
    expect(t).toContain("Showing 26–50 of 60 · Page 2 of 3");
  });

  it("renders loading, not-found and error states", () => {
    expect(renderToStaticMarkup(<OverdueCustomerBillsList state={{ kind: "loading" }} />)).toContain('aria-busy="true"');
    expect(text(renderToStaticMarkup(<OverdueCustomerBillsList state={{ kind: "notFound", message: "This customer has no overdue bills." }} />))).toContain("no overdue bills");
    expect(text(renderToStaticMarkup(<OverdueCustomerBillsList state={{ kind: "error", message: "Failed" }} onRetry={() => {}} />))).toContain("Try again");
  });
});

describe("OverdueBillDetail", () => {
  const detail: Detail = {
    configured: true,
    billNo: "2",
    entries: [
      {
        billNo: "2",
        customerName: "Alpha Stores",
        billDate: "2026-04-02 10:00:00",
        dueDate: "2026-07-01 10:00:00",
        dueDays: "30",
        daysOverdue: 118,
        billAmount: "21000.00",
        paidAmount: "1000.00",
        balanceDue: "20000.00",
        finalStatus: "Overdue",
        lastFollowUpDate: "2026-07-05 10:00:00",
        lastFollowUpStage: "Reminder 2",
        followUpMode: "Call",
        customerCaption: "",
        dateReceived: "---",
        account: { accountId: "acc_1", accountName: "Alpha Stores" },
        order: { timestamp: "2026-04-02 10:00:00", productAndQty: "R (3.15) - 2 Box", orderTaken: "Aditya", dispatchedBy: "Ram", dispatchedDate: "2026-04-02 00:00:00", orderValue: "21000.00", cancelled: false },
      },
    ],
    asOfDate: "2026-10-27",
    fetchedAt: "2026-10-27T05:00:00.000Z",
  };

  it("shows the payment and order details for the bill, with a link to the account", () => {
    const html = renderToStaticMarkup(<OverdueBillDetail state={{ kind: "data", data: detail }} />);
    const t = text(html);
    for (const s of ["Overdue", "Paid Amount", "Outstanding Amount", "20,000", "Reminder 2", "Call", "Aditya", "R (3.15) - 2 Box", "Order value"]) expect(t).toContain(s);
    expect(html).toContain('href="/leads/accounts/acc_1"');
  });

  it("explains when the bill has no linked order", () => {
    const t = text(renderToStaticMarkup(<OverdueBillDetail state={{ kind: "data", data: { ...detail, entries: [{ ...detail.entries[0], order: null, account: null }] } }} />));
    expect(t).toContain("couldn't be linked");
  });
});
