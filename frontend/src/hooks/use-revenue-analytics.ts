import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RevenueAnalyticsDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

const REVENUE_ANALYTICS_KEY = "revenue-analytics" as const;

/**
 * Fetches the revenue analytics summary (trend series + forecast tail,
 * breakdowns, pipeline funnel, and narrative). Mirrors useMarketExpansion.
 */
export function useRevenueAnalytics() {
  return useQuery({
    queryKey: [REVENUE_ANALYTICS_KEY],
    queryFn: () => apiGet<RevenueAnalyticsDTO>("/revenue-analytics"),
    staleTime: 30_000,
  });
}

/**
 * Regenerates revenue analytics, bypassing the cache. ADMIN/MANAGER only —
 * the backend returns 403 for other roles (mirrors useRegenerateMarketExpansion).
 */
export function useRegenerateRevenueAnalytics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiGet<RevenueAnalyticsDTO>("/revenue-analytics", { force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData([REVENUE_ANALYTICS_KEY], data);
    },
  });
}
