import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SalesAgentTodayDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

const SALES_AGENT_TODAY_KEY = ["sales-agent", "today"] as const;

/**
 * Fetches today's AI Sales Agent priorities. Never passes an explicit
 * `limit` — the backend caches one response per company per calendar day
 * keyed only by company+date, so every caller must converge on the same
 * (default-sized) cached set rather than risk a stale/mismatched limit.
 */
export function useSalesAgentToday() {
  return useQuery({
    queryKey: SALES_AGENT_TODAY_KEY,
    queryFn: () => apiGet<SalesAgentTodayDTO>("/sales-agent/today"),
    staleTime: 30_000,
  });
}

/**
 * Regenerates today's priorities, bypassing the cache. This is a GET with a
 * server-side side effect (the existing backend contract) — ADMIN/MANAGER
 * only; the backend returns 403 for other roles.
 */
export function useRegenerateSalesAgentToday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiGet<SalesAgentTodayDTO>("/sales-agent/today", { force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(SALES_AGENT_TODAY_KEY, data);
    },
  });
}
