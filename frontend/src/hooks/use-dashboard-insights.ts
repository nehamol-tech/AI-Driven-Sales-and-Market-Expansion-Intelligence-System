import { useQuery } from "@tanstack/react-query";
import type { DashboardInsightsDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

/**
 * Fetches the real, deterministically-detected business signals (problems +
 * opportunities) that power the redesigned dashboard's action panels. Both
 * arrays can legitimately be empty — an empty list is an honest "nothing to
 * flag right now," never an error. Mirrors useDashboardOverview.
 */
export function useDashboardInsights() {
  return useQuery({
    queryKey: ["dashboard-insights"],
    queryFn: () => apiGet<DashboardInsightsDTO>("/dashboard/insights"),
    staleTime: 30_000,
  });
}
