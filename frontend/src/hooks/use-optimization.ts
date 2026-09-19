import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GenerateRecommendationsResultDTO,
  OptimizationRecommendationDTO,
  OptimizationRecommendationStatus,
  OptimizationRecommendationType,
} from "@ai-sales/shared";
import { apiGet, apiPost } from "@/lib/api-client";
import type { PaginatedResponse } from "@/lib/types";

const OPTIMIZATION_KEY = "optimization" as const;

export interface OptimizationFilters {
  status?: OptimizationRecommendationStatus;
  type?: OptimizationRecommendationType;
  page?: number;
  pageSize?: number;
}

/**
 * Open to every role. The live controller returns `{ data, pagination }`
 * (see backend/src/modules/optimization/optimization.controller.ts `list`) —
 * this matches `PaginatedResponse<T>` exactly, not the
 * `PaginatedOptimizationRecommendationsDTO` (`{items,total,page,pageSize}`)
 * shape that the shared package's internal service layer uses — that shape
 * never reaches the HTTP boundary.
 */
export function useOptimizationRecommendations(filters: OptimizationFilters = {}) {
  return useQuery({
    queryKey: [OPTIMIZATION_KEY, filters],
    queryFn: () =>
      apiGet<PaginatedResponse<OptimizationRecommendationDTO>>("/optimization", {
        status: filters.status,
        type: filters.type,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 50,
      }),
  });
}

/** Open to every role. */
export function useOptimizationRecommendation(id: string | null | undefined) {
  return useQuery({
    queryKey: [OPTIMIZATION_KEY, id],
    queryFn: () => apiGet<OptimizationRecommendationDTO>(`/optimization/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * ADMIN/MANAGER only server-side (403 for SALES_USER) — UI hides the
 * Generate button for other roles. Unlike a "regenerate" analytics endpoint
 * elsewhere in this app, this creates NEW persisted rows (or reports
 * `skippedDuplicates`) rather than replacing a cached snapshot — so the
 * result is surfaced to the caller (for a toast) and the list is
 * invalidated/refetched, never overwritten with `setQueryData`.
 */
export function useGenerateRecommendations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<GenerateRecommendationsResultDTO>("/optimization/generate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [OPTIMIZATION_KEY] }),
  });
}

/**
 * ADMIN/MANAGER only server-side (403 for SALES_USER). Triggers a real
 * business mutation (follow-up creation or campaign pause) via the backend's
 * validate -> re-validate -> authorize -> execute -> audit -> result
 * pipeline. Both `EXECUTED` and `EXECUTION_FAILED` are normal 200 responses
 * (a stale live condition is an expected, honestly-surfaced outcome, not a
 * thrown error) — only an already-reviewed recommendation 409s.
 */
export function useApproveRecommendation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<OptimizationRecommendationDTO>(`/optimization/${id}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [OPTIMIZATION_KEY] }),
  });
}

/** ADMIN/MANAGER only server-side (403 for SALES_USER). */
export function useRejectRecommendation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<OptimizationRecommendationDTO>(`/optimization/${id}/reject`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [OPTIMIZATION_KEY] }),
  });
}
