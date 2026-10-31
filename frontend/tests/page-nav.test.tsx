import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/revenue-analytics";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

const { PageNav, parentPath } = await import("@/components/layout/page-nav");

describe("parentPath (Back without in-app history)", () => {
  it.each([
    ["/revenue-analytics", "/dashboard"],
    ["/fms", "/dashboard"],
    ["/sales-agent", "/dashboard"],
    ["/sales/import", "/sales"],
    ["/leads/accounts/acc_1", "/leads"],
    ["/leads/prospects/p_1", "/leads"],
    ["/opportunities/overdue", "/opportunities"],
    ["/opportunities/REORDER", "/opportunities"],
    ["/opportunities/overdue/acc_1", "/opportunities/overdue"],
    ["/opportunities/overdue/bills/2885", "/opportunities/overdue"],
    ["/market-expansion/state_1", "/market-expansion"],
    ["/unknown/deep/page", "/dashboard"],
  ])("%s → %s", (from, to) => {
    expect(parentPath(from)).toBe(to);
  });
});

describe("PageNav", () => {
  beforeEach(() => {
    pathname = "/revenue-analytics";
  });

  it("shows Back and Dashboard on inner pages", () => {
    const html = renderToStaticMarkup(<PageNav />);
    expect(html).toContain('aria-label="Page navigation"');
    expect(html).toContain('aria-label="Go back"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain(">Back<");
    expect(html).toContain(">Dashboard<");
  });

  it("is not shown on the dashboard itself", () => {
    pathname = "/dashboard";
    expect(renderToStaticMarkup(<PageNav />)).toBe("");
  });

  it("keeps icon-only buttons on small screens (labels hidden below sm)", () => {
    const html = renderToStaticMarkup(<PageNav />);
    expect(html.match(/class="hidden sm:inline"/g)).toHaveLength(2);
  });
});
