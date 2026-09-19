import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DistributorDTO,
  DistributorExpansionSummaryDTO,
  DistributorStatus,
  DistributorType,
} from "@ai-sales/shared";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import type { PaginatedResponse } from "@/lib/types";

const DISTRIBUTORS_KEY = "distributors" as const;
const DISTRIBUTOR_EXPANSION_KEY = "distributor-expansion" as const;

/* ------------------------------------------------------------------ */
/* Distributors                                                       */
/* ------------------------------------------------------------------ */

export interface DistributorFilters {
  type?: DistributorType;
  status?: DistributorStatus;
  page?: number;
  pageSize?: number;
}

/** Open to every role. Fetched with a large pageSize since the /distributors page renders the full list, not a paginated table (mirrors useAdCampaigns' pageSize:100 convention for small reference lists). */
export function useDistributors(filters: DistributorFilters = {}) {
  return useQuery({
    queryKey: [DISTRIBUTORS_KEY, filters],
    queryFn: () =>
      apiGet<PaginatedResponse<DistributorDTO>>("/distributors", {
        type: filters.type,
        status: filters.status,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 100,
      }),
  });
}

/** Open to every role. */
export function useDistributor(id: string | null | undefined) {
  return useQuery({
    queryKey: [DISTRIBUTORS_KEY, id],
    queryFn: () => apiGet<DistributorDTO>(`/distributors/${id}`),
    enabled: Boolean(id),
  });
}

export interface DistributorInput {
  name: string;
  type: DistributorType;
  status?: DistributorStatus;
  contactEmail?: string | null;
  contactPhone?: string | null;
  assignedUserId?: string | null;
  onboardedAt?: string | null;
  stateIds?: string[];
}

/** Open to every role — mirrors how any role can log a Sales record or create a Prospect/AdCampaign. */
export function useCreateDistributor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DistributorInput) => apiPost<DistributorDTO>("/distributors", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [DISTRIBUTORS_KEY] }),
  });
}

/**
 * Open to every role. Note: `PUT` REPLACES the full territory set when
 * `stateIds` is present in the input — it is not a diff/merge against the
 * distributor's existing territories.
 */
export function useUpdateDistributor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<DistributorInput> }) =>
      apiPut<DistributorDTO>(`/distributors/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [DISTRIBUTORS_KEY] }),
  });
}

/** ADMIN/MANAGER only server-side (403 for SALES_USER) — UI hides this action entirely for SALES_USER, matching Prospect/FollowUp/AdCampaign's delete precedent. */
export function useDeleteDistributor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/distributors/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [DISTRIBUTORS_KEY] }),
  });
}

/* ------------------------------------------------------------------ */
/* Expansion analytics                                                */
/* ------------------------------------------------------------------ */

/**
 * Fetches the distributor expansion summary (daily-cached recommendations +
 * performance + narrative). Mirrors useAdvertisingAnalytics.
 */
export function useDistributorExpansion() {
  return useQuery({
    queryKey: [DISTRIBUTOR_EXPANSION_KEY],
    queryFn: () => apiGet<DistributorExpansionSummaryDTO>("/distributors/expansion"),
    staleTime: 30_000,
  });
}

/**
 * Regenerates the distributor expansion summary, bypassing the cache.
 * ADMIN/MANAGER only — the backend returns 403 for other roles (mirrors
 * useRegenerateAdvertisingAnalytics exactly).
 */
export function useRegenerateDistributorExpansion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiGet<DistributorExpansionSummaryDTO>("/distributors/expansion", { force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData([DISTRIBUTOR_EXPANSION_KEY], data);
    },
  });
}
