import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OverdueAccountsResponseDTO } from "@ai-sales/shared";
import { OverdueAccountsList, toOverdueViewState, type OverdueViewState } from "@/components/opportunities/overdue-accounts-view";
import { ApiError } from "@/lib/api-client";

type Data = Extract<OverdueAccountsResponseDTO, { configured: true }>;

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function data(overrides: Partial<Data> = {}): Data {
  return {
    configured: true,
    data: [
      {
        accountId: "acc_1",
        accountName: "Alpha Stores",
        customerCode: "AD1",
        totalOutstanding: "75000.00",
        overdueAmount: "70000.00",
        daysOverdue: 118,
        overdueBills: [
          { billNo: "2", billDate: "2026-04-02 10:00:00", dueDate: "2026-07-01 10:00:00", daysOverdue: 118, billAmount: "21000.00", balanceDue: "20000.00" },
          { billNo: "1", billDate: "2026-09-20 10:00:00", dueDate: "2026-10-20 10:00:00", daysOverdue: 7, billAmount: "51000.00", balanceDue: "50000.00" },
        ],
        orderTakenBy: ["Aditya"],
        opportunities: [{ type: "AT_RISK", priority: "HIGH" }],
      },
      {
        accountId: "acc_2",
        accountName: "Beta Traders",
        customerCode: null,
        totalOutstanding: "9000.00",
        overdueAmount: "9000.00",
        daysOverdue: 45,
        overdueBills: [{ billNo: "4", billDate: "2026-08-01 10:00:00", dueDate: "2026-09-12 10:00:00", daysOverdue: 45, billAmount: "9000.00", balanceDue: "9000.00" }],
        orderTakenBy: [],
        opportunities: [],
      },
    ],
    pagination: { page: 1, pageSize: 25, total: 2 },
    summary: { accounts: 2, totalOverdueAmount: "79000.00", averageOverdueAmount: "39500.00", highestOverdueAmount: "70000.00" },
    unlinked: { bills: 0, amount: "0.00" },
    asOfDate: "2026-10-27",
    fetchedAt: "2026-10-27T05:00:00.000Z",
    retrieval: { complete: true, reason: "ok" },
    ...overrides,
  };
}

const render = (state: OverdueViewState, extra: { search?: string; filtered?: boolean } = {}) =>
  renderToStaticMarkup(<OverdueAccountsList state={state} onRetry={() => {}} {...extra} />);
const idle = { isLoading: false, isError: false, error: null, data: undefined };

describe("toOverdueViewState", () => {
  it("maps loading, 401, errors, unconfigured and data", () => {
    expect(toOverdueViewState({ ...idle, isLoading: true })).toEqual({ kind: "loading" });
    expect(toOverdueViewState({ ...idle, isError: true, error: new ApiError(401, "x") })).toEqual({ kind: "unauthenticated" });
    expect(toOverdueViewState({ ...idle, isError: true, error: new ApiError(502, "Failed") })).toEqual({ kind: "error", message: "Failed" });
    expect(toOverdueViewState({ ...idle, data: { configured: false, message: "not set" } })).toEqual({ kind: "unconfigured", message: "not set" });
    expect(toOverdueViewState({ ...idle, data: data() }).kind).toBe("data");
  });
});

describe("OverdueAccountsList", () => {
  it("shows the four summary figures", () => {
    const t = text(render({ kind: "data", data: data() }));
    for (const label of ["Overdue accounts", "Total overdue", "Average overdue", "Highest overdue"]) expect(t).toContain(label);
    expect(t).toContain("79,000");
    expect(t).toContain("39,500");
    expect(t).toContain("70,000");
  });

  it("renders each account's code, amounts, oldest bill, days, salesperson, signals and View Account", () => {
    const html = render({ kind: "data", data: data() });
    const t = text(html);
    expect(t).toContain("Alpha Stores");
    expect(t).toContain("Code AD1");
    expect(t).toContain("No customer code");
    expect(t).toContain("75,000");
    expect(t).toContain("Bill 2");
    expect(t).toContain("Due 01 Jul 2026");
    expect(t).toContain("+1 more overdue bill: 1");
    expect(t).toContain("118");
    expect(t).toContain("Aditya");
    expect(t).toContain("At Risk");
    expect(html).toContain('href="/leads/accounts/acc_1"');
    expect(html).toContain('href="/leads/accounts/acc_2"');
    expect(t.match(/View Account/g)).toHaveLength(2);
    expect(html).toContain('href="/opportunities/overdue/acc_1"');
    expect(t).toContain("View Bills (2)");
    expect(t).toContain("View Bills (1)");
  });

  it("flags bills that couldn't be linked, and incomplete retrieval", () => {
    const html = render({
      kind: "data",
      data: data({ unlinked: { bills: 2, amount: "5000.00" }, retrieval: { complete: false, reason: "Later bills may be missing." } }),
    });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("2 overdue bills");
    expect(text(html)).toContain("Later bills may be missing.");
  });

  it("distinguishes no overdue accounts at all from no matches", () => {
    const none = data({ data: [], pagination: { page: 1, pageSize: 25, total: 0 }, summary: { accounts: 0, totalOverdueAmount: "0.00", averageOverdueAmount: "0.00", highestOverdueAmount: "0.00" } });
    expect(text(render({ kind: "data", data: none }))).toContain("No overdue accounts.");
    const noMatch = data({ data: [], pagination: { page: 1, pageSize: 25, total: 0 } });
    expect(text(render({ kind: "data", data: noMatch }, { search: "zzz", filtered: true }))).toContain('Nothing matches "zzz"');
    expect(text(render({ kind: "data", data: noMatch }, { filtered: true }))).toContain("No accounts fall in this age range.");
  });

  it("pages", () => {
    const t = text(render({ kind: "data", data: data({ pagination: { page: 2, pageSize: 25, total: 60 } }) }));
    expect(t).toContain("Showing 26–50 of 60 · Page 2 of 3");
  });

  it("renders loading, sign-in, error and unconfigured states", () => {
    expect(render({ kind: "loading" })).toContain('aria-busy="true"');
    expect(render({ kind: "unauthenticated" })).toContain('href="/login"');
    expect(text(render({ kind: "error", message: "Failed" }))).toContain("Try again");
    expect(text(render({ kind: "unconfigured", message: "Set FMS_API_URL." }))).toContain("Payment data not connected");
  });
});
