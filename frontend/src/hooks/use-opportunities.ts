import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpportunityQueryFilters, OpportunitySummaryDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

const OPPORTUNITIES_KEY = "opportunities" as const;

/**
 * Fetches detected sales opportunities. `type`/`priority`/`limit` are passed
 * straight through as query params — the backend does the filtering, so we
 * never re-filter or re-sort the returned list client-side.
 */
export function useOpportunities(filters: OpportunityQueryFilters = {}) {
  return useQuery({
    queryKey: [OPPORTUNITIES_KEY, filters],
    queryFn: () =>
      apiGet<OpportunitySummaryDTO>("/sales-agent/opportunities", {
        type: filters.type,
        priority: filters.priority,
        limit: filters.limit,
      }),
    staleTime: 30_000,
  });
}

/**
 * Regenerates opportunities, bypassing the cache. This is a GET with a
 * server-side side effect (mirrors useRegenerateSalesAgentToday exactly) —
 * ADMIN/MANAGER only; the backend returns 403 for other roles.
 */
export function useRegenerateOpportunities(filters: OpportunityQueryFilters = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiGet<OpportunitySummaryDTO>("/sales-agent/opportunities", {
        type: filters.type,
        priority: filters.priority,
        limit: filters.limit,
        force: true,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData([OPPORTUNITIES_KEY, filters], data);
    },
  });
}
