"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";

export const DASHBOARD_PATH = "/dashboard";

/** Top-level pages a Back button can fall back to (the sidebar's destinations). */
const SECTION_PATHS = new Set([
  "/dashboard",
  "/company",
  "/products",
  "/sales",
  "/leads",
  "/opportunities",
  "/opportunities/overdue",
  "/market-expansion",
  "/follow-ups",
  "/revenue-analytics",
  "/advertising",
  "/distributors",
  "/optimization",
  "/fms",
  "/assistant",
  "/users",
  "/sales-agent",
]);

/**
 * Where Back goes when there is no in-app history (page opened directly or
 * from a bookmark): the nearest parent page, e.g. /leads/accounts/x → /leads,
 * /sales/import → /sales; a top-level page → the dashboard.
 */
export function parentPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  for (let n = segments.length - 1; n > 0; n--) {
    const candidate = `/${segments.slice(0, n).join("/")}`;
    if (SECTION_PATHS.has(candidate)) return candidate;
  }
  return DASHBOARD_PATH;
}

const NAV_COUNT_KEY = "asee-nav-count";

/** Counts page changes in this tab, so Back only uses browser history the user built inside the app. */
function useInAppHistory(pathname: string): () => boolean {
  React.useEffect(() => {
    try {
      const count = Number(sessionStorage.getItem(NAV_COUNT_KEY) ?? "0");
      sessionStorage.setItem(NAV_COUNT_KEY, String(count + 1));
    } catch {
      // storage unavailable — Back will use the parent-page fallback
    }
  }, [pathname]);
  return () => {
    try {
      return Number(sessionStorage.getItem(NAV_COUNT_KEY) ?? "0") > 1 && window.history.length > 1;
    } catch {
      return false;
    }
  };
}

/** Back + Dashboard buttons at the top-left of every inner page (not shown on the dashboard itself). */
export function PageNav() {
  const pathname = usePathname() ?? DASHBOARD_PATH;
  const router = useRouter();
  const canGoBack = useInAppHistory(pathname);

  if (pathname === DASHBOARD_PATH) return null;

  const goBack = () => {
    if (canGoBack()) router.back();
    else router.push(parentPath(pathname));
  };

  return (
    <nav aria-label="Page navigation" className="mb-4 flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={goBack} aria-label="Go back" className="gap-1.5">
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Back</span>
      </Button>
      <Button asChild variant="ghost" size="sm" className="gap-1.5">
        <Link href={DASHBOARD_PATH} aria-label="Go to dashboard">
          <LayoutDashboard className="h-4 w-4" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>
      </Button>
    </nav>
  );
}
