import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OpportunityAccountsResponseDTO, OpportunitySummaryDTO } from "@ai-sales/shared";
import { OPPORTUNITY_CATEGORIES } from "@ai-sales/shared";
import {
  OpportunityAccountsList,
  describeCategoryTotal,
  toOpportunityAccountsViewState,
  type OpportunityAccountsViewState,
} from "@/components/opportunities/opportunity-accounts-view";
import { OpportunitySummaryGrid } from "@/components/opportunities/opportunity-summary-grid";
import { categoryFromSlug, opportunityCategoryHref } from "@/components/opportunities/opportunity-categories";
import { ApiError } from "@/lib/api-client";

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function response(overrides: Partial<OpportunityAccountsResponseDTO> = {}): OpportunityAccountsResponseDTO {
  return {
    data: [
      {
        opportunityId: "REORDER-acc_1",
        type: "REORDER",
        priority: "HIGH",
        accountId: "acc_1",
        accountName: "Acme Retail",
        industryName: "Retail",
        score: 80,
        classification: "HOT",
        productName: null,
        orderCount: 12,
        totalOrderValue: "125000.00",
        lastOrderDate: "2026-09-01T00:00:00.000Z",
        daysSinceLastOrder: 56,
        evidence: [{ label: "Days overdue", value: "26 days" }],
        reason: "Acme Retail is 26 days past its usual reorder cycle.",
        recommendedAction: "Call today.",
      },
      {
        opportunityId: "AT_RISK-acc_1",
        type: "AT_RISK",
        priority: "HIGH",
        accountId: "acc_1",
        accountName: "Acme Retail",
        industryName: null,
        score: null,
        classification: null,
        productName: null,
        orderCount: 12,
        totalOrderValue: "125000.00",
        lastOrderDate: null,
        daysSinceLastOrder: null,
        evidence: [],
        reason: null,
        recommendedAction: "Check in.",
      },
    ],
    pagination: { page: 1, pageSize: 25, total: 2 },
    category: "HIGH_PRIORITY",
    categoryTotal: 2,
    categoryAccountCount: 1,
    generatedAt: "2026-10-27T05:00:00.000Z",
    ...overrides,
  };
}

const nextButton = (html: string) =>
  [...html.matchAll(/<button[^>]*>.*?<\/button>/g)].map((m) => m[0]).find((b) => text(b).includes("Next")) ?? "";
const render = (state: OpportunityAccountsViewState, search?: string) =>
  renderToStaticMarkup(<OpportunityAccountsList category="HIGH_PRIORITY" state={state} search={search} onRetry={() => {}} />);
const idle = { isLoading: false, isError: false, error: null, data: undefined };

describe("opportunity categories", () => {
  it("round-trips every card's URL slug", () => {
    for (const c of OPPORTUNITY_CATEGORIES) {
      const slug = opportunityCategoryHref(c).replace("/opportunities/", "");
      expect(categoryFromSlug(slug)).toBe(c);
    }
    expect(categoryFromSlug("nope")).toBeNull();
    expect(opportunityCategoryHref("HIGH_PRIORITY")).toBe("/opportunities/high-priority");
  });
});

describe("OpportunitySummaryGrid", () => {
  const summary: OpportunitySummaryDTO = {
    generatedAt: "x",
    counts: { REORDER: 260, AT_RISK: 172, CROSS_SELL: 0, HIGH_VALUE: 106, REACTIVATION: 22, GROWING_ACCOUNT: 4 },
    highPriorityCount: 453,
    opportunities: [],
    totalOpportunities: 564,
  };

  it("makes all 7 cards links to their detail pages, showing the same counts", () => {
    const html = renderToStaticMarkup(<OpportunitySummaryGrid summary={summary} isLoading={false} hrefFor={opportunityCategoryHref} />);
    for (const c of OPPORTUNITY_CATEGORIES) expect(html).toContain(`href="${opportunityCategoryHref(c)}"`);
    expect(html.match(/<a /g)).toHaveLength(7);
    for (const n of ["453", "260", "172", "106", "22", "4"]) expect(text(html)).toContain(` ${n} `);
    expect(html).toContain("cursor-pointer");
  });

  it("renders plain, non-link cards when no hrefFor is given (unchanged behaviour elsewhere)", () => {
    const html = renderToStaticMarkup(<OpportunitySummaryGrid summary={summary} isLoading={false} />);
    expect(html).not.toContain("<a ");
  });
});

describe("toOpportunityAccountsViewState", () => {
  it("maps loading, 401, other errors and data", () => {
    expect(toOpportunityAccountsViewState({ ...idle, isLoading: true })).toEqual({ kind: "loading" });
    expect(toOpportunityAccountsViewState({ ...idle, isError: true, error: new ApiError(401, "x") })).toEqual({ kind: "unauthenticated" });
    expect(toOpportunityAccountsViewState({ ...idle, isError: true, error: new ApiError(500, "Boom") })).toEqual({ kind: "error", message: "Boom" });
    expect(toOpportunityAccountsViewState({ ...idle, data: response() }).kind).toBe("data");
  });
});

describe("describeCategoryTotal", () => {
  it("states opportunities and accounts separately when they differ, so the card's count is never mislabelled", () => {
    expect(describeCategoryTotal({ categoryTotal: 453, categoryAccountCount: 244 })).toBe("453 opportunities across 244 accounts");
    expect(describeCategoryTotal({ categoryTotal: 260, categoryAccountCount: 260 })).toBe("260 accounts");
    expect(describeCategoryTotal({ categoryTotal: 1, categoryAccountCount: 1 })).toBe("1 account");
  });
});

describe("OpportunityAccountsList", () => {
  it("renders each row's account, type, priority, figures, signal and a View Account link", () => {
    const html = render({ kind: "data", data: response() });
    const t = text(html);
    expect(t).toContain("Acme Retail");
    expect(t).toContain("ID acc_1");
    expect(t).toContain("Reorder");
    expect(t).toContain("HIGH");
    expect(t).toContain("12");
    expect(t).toContain("56");
    expect(t).toContain("26 days past its usual reorder cycle");
    expect(t).toContain("Days overdue: 26 days");
    expect(html.match(/href="\/leads\/accounts\/acc_1"/g)).toHaveLength(2);
    expect(t).toContain("View Account");
    expect(t).toContain("Showing 1–2 of 2 · Page 1 of 1");
  });

  it("shows a dash rather than inventing missing figures", () => {
    const t = text(render({ kind: "data", data: response() }));
    expect(t).toContain("No industry");
    expect(t).toMatch(/—/);
  });

  it("enables Next only when there is another page", () => {
    const last = render({ kind: "data", data: response({ pagination: { page: 1, pageSize: 25, total: 2 } }) });
    expect(nextButton(last)).toMatch(/\sdisabled=""/);
    const more = render({ kind: "data", data: response({ pagination: { page: 1, pageSize: 2, total: 5 } }) });
    expect(nextButton(more)).not.toMatch(/\sdisabled=""/);
    expect(nextButton(more)).toContain("Next");
    expect(text(more)).toContain("Page 1 of 3");
  });

  it("explains an empty card (e.g. Cross-Sell at 0) differently from an empty search", () => {
    const zero = text(render({ kind: "data", data: response({ data: [], categoryTotal: 0, categoryAccountCount: 0, pagination: { page: 1, pageSize: 25, total: 0 } }) }));
    expect(zero).toContain("No High Priority opportunities right now.");
    const noMatch = text(render({ kind: "data", data: response({ data: [], pagination: { page: 1, pageSize: 25, total: 0 } }) }, "zzz"));
    expect(noMatch).toContain('Nothing in High Priority matches "zzz"');
  });

  it("renders the loading, sign-in and error states", () => {
    expect(render({ kind: "loading" })).toContain('aria-busy="true"');
    expect(render({ kind: "unauthenticated" })).toContain('href="/login"');
    const err = text(render({ kind: "error", message: "Boom" }));
    expect(err).toContain("Boom");
    expect(err).toContain("Try again");
  });
});
