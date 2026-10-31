import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardPageLoading from "@/app/(dashboard)/loading";

describe("dashboard route loading placeholder", () => {
  it("renders an accessible busy placeholder for the page area only", () => {
    const html = renderToStaticMarkup(<DashboardPageLoading />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading page"');
    expect(html).not.toContain("<aside"); // sidebar stays in the layout, not in the placeholder
  });
});
