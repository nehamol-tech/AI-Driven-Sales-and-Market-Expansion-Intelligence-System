import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateFollowUpInput,
  FollowUpDTO,
  FollowUpDueByFilter,
  FollowUpStatus,
  FollowUpSummaryDTO,
  LeadType,
  UpdateFollowUpInput,
} from "@ai-sales/shared";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";

const FOLLOW_UPS_KEY = "follow-ups" as const;

export interface FollowUpFilters {
  status?: FollowUpStatus;
  dueBy?: FollowUpDueByFilter;
  leadType?: LeadType;
  limit?: number;
}

/**
 * Fetches the follow-ups summary (overdue/today/week counts + items).
 * `status`/`dueBy`/`leadType`/`limit` are passed straight through as query
 * params — the backend does the filtering. Per the verified live API
 * contract, the three counts always reflect the full real PENDING set,
 * independent of whatever filter is applied to `items`.
 */
export function useFollowUps(filters: FollowUpFilters = {}) {
  return useQuery({
    queryKey: [FOLLOW_UPS_KEY, filters],
    queryFn: () =>
      apiGet<FollowUpSummaryDTO>("/follow-ups", {
        status: filters.status,
        dueBy: filters.dueBy,
        leadType: filters.leadType,
        limit: filters.limit,
      }),
    staleTime: 15_000,
  });
}

export function useCreateFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFollowUpInput) => apiPost<FollowUpDTO>("/follow-ups", input),
    // Broad invalidation so counts/lists everywhere (the /follow-ups page,
    // and any lead-detail-page Follow-ups section) stay in sync.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [FOLLOW_UPS_KEY] }),
  });
}

/**
 * Covers reschedule, edit, complete, and cancel — one mutation, different
 * payloads. There is deliberately no `completedAt` field anywhere in
 * UpdateFollowUpInput; the backend always derives it from `status`.
 */
export function useUpdateFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateFollowUpInput }) =>
      apiPut<FollowUpDTO>(`/follow-ups/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [FOLLOW_UPS_KEY] }),
  });
}

/** ADMIN/MANAGER only server-side (403 for other roles) — UI hides/disables the action as a convenience. */
export function useDeleteFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/follow-ups/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [FOLLOW_UPS_KEY] }),
  });
}
