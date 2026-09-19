import { useQuery } from "@tanstack/react-query";
import type { SalesTrendDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

export interface SalesTrendFilters {
  dateFrom?: string;
  dateTo?: string;
  stateId?: string;
  productId?: string;
  distributorId?: string;
}

/**
 * Fetches the filtered sales trend (series + top products + distributor
 * performance), all driven by the same filtered SalesRecord set. This is a
 * live, filter-driven query — no staleTime, so changing a filter always
 * refetches instead of serving a stale cached page.
 */
export function useSalesTrend(filters: SalesTrendFilters) {
  return useQuery({
    queryKey: ["sales-trend", filters],
    queryFn: () => apiGet<SalesTrendDTO>("/dashboard/sales-trend", { ...filters }),
  });
}
