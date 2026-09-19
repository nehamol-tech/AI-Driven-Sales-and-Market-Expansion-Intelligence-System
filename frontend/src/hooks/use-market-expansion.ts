import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarketDetailDTO, MarketExpansionSummaryDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

const MARKET_EXPANSION_KEY = "market-expansion" as const;

/**
 * Fetches the ranked, narrated market expansion summary. `markets` is
 * already ranked by score desc and bounded by `limit` (default 10, max 20)
 * server-side — the frontend never re-sorts unless the user explicitly
 * picks a different sort, and even then only client-side over this same
 * bounded list (mirrors useOpportunities' pass-through pattern).
 */
export function useMarketExpansion(limit?: number) {
  return useQuery({
    queryKey: [MARKET_EXPANSION_KEY, limit],
    queryFn: () => apiGet<MarketExpansionSummaryDTO>("/sales-agent/market-expansion", { limit }),
    staleTime: 30_000,
  });
}

/**
 * Fetches full detail for one state, including real
 * cityBreakdown/industrySignals/productSignals/growthSignal/expansionHypotheses
 * on top of the summary fields. Disabled until a stateId is known.
 */
export function useMarketDetail(stateId: string | undefined) {
  return useQuery({
    queryKey: [MARKET_EXPANSION_KEY, "detail", stateId],
    queryFn: () => apiGet<MarketDetailDTO>(`/sales-agent/market-expansion/${stateId}`),
    enabled: Boolean(stateId),
    staleTime: 30_000,
  });
}

/**
 * Regenerates the market expansion summary, bypassing the cache. ADMIN/MANAGER
 * only — the backend returns 403 for other roles (mirrors useRegenerateOpportunities).
 */
export function useRegenerateMarketExpansion(limit?: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiGet<MarketExpansionSummaryDTO>("/sales-agent/market-expansion", { limit, force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData([MARKET_EXPANSION_KEY, limit], data);
    },
  });
}
