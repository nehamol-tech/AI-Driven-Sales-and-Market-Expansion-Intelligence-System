import { useQuery } from "@tanstack/react-query";
import type { DashboardOverviewDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

export function useDashboardOverview() {
  return useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: () => apiGet<DashboardOverviewDTO>("/dashboard/overview"),
    staleTime: 30_000,
  });
}
