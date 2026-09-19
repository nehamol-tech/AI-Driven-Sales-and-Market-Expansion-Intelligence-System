import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AccountDTO,
  ProspectDTO,
  ProspectStatus,
  LeadScoreDTO,
  LeadScoreResult,
  LeadScoreFeedbackDTO,
  LeadSummaryDTO,
  LeadClassification,
  LeadType,
  FeedbackRating,
} from "@ai-sales/shared";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import type { PaginatedResponse } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Accounts                                                           */
/* ------------------------------------------------------------------ */

export interface AccountFilters {
  search?: string;
  classification?: LeadClassification;
  minScore?: number;
  hasScore?: boolean;
  page?: number;
  pageSize?: number;
}

export function useAccounts(filters: AccountFilters) {
  return useQuery({
    queryKey: ["leads", "accounts", filters],
    queryFn: () =>
      apiGet<PaginatedResponse<AccountDTO>>("/leads/accounts", {
        search: filters.search,
        classification: filters.classification,
        minScore: filters.minScore,
        hasScore: filters.hasScore,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
      }),
    placeholderData: (prev) => prev,
  });
}

export interface AccountDetailDTO {
  account: AccountDTO;
  scoreHistory: LeadScoreDTO[];
}

export function useAccount(id: string | null | undefined) {
  return useQuery({
    queryKey: ["leads", "accounts", id],
    queryFn: () => apiGet<AccountDetailDTO>(`/leads/accounts/${id}`),
    enabled: Boolean(id),
  });
}

export function useScoreAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      apiPost<LeadScoreResult>(`/leads/accounts/${id}/score`, { force }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Prospects                                                          */
/* ------------------------------------------------------------------ */

export interface ProspectFilters {
  search?: string;
  classification?: LeadClassification;
  minScore?: number;
  hasScore?: boolean;
  page?: number;
  pageSize?: number;
}

export function useProspects(filters: ProspectFilters) {
  return useQuery({
    queryKey: ["leads", "prospects", filters],
    queryFn: () =>
      apiGet<PaginatedResponse<ProspectDTO>>("/leads/prospects", {
        search: filters.search,
        classification: filters.classification,
        minScore: filters.minScore,
        hasScore: filters.hasScore,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
      }),
    placeholderData: (prev) => prev,
  });
}

export interface ProspectDetailDTO {
  prospect: ProspectDTO;
  scoreHistory: LeadScoreDTO[];
}

export function useProspect(id: string | null | undefined) {
  return useQuery({
    queryKey: ["leads", "prospects", id],
    queryFn: () => apiGet<ProspectDetailDTO>(`/leads/prospects/${id}`),
    enabled: Boolean(id),
  });
}

export interface ProspectInput {
  businessName: string;
  industryId?: string | null;
  businessTypeId?: string | null;
  stateId?: string | null;
  cityId?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Phase 5: pipeline stage. Optional here since the backend's update schema treats every field as an optional partial update. */
  status?: ProspectStatus;
  assignedUserId?: string | null;
  productsOfInterestIds?: string[];
  /** Phase 7: which ad campaign (if any) this prospect is attributed to — feeds AdCampaign analytics' leadsGenerated/leadsWon/costPerLead. */
  campaignId?: string | null;
}

export function useCreateProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProspectInput) => apiPost<ProspectDTO>("/leads/prospects", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
}

/**
 * Backend's PUT /leads/prospects/:id treats every field as an optional
 * partial update (see updateProspectSchema) — accepting `Partial<ProspectInput>`
 * here lets callers send just `{ status }` for the Phase 5 stage editor
 * without having to resend the rest of the prospect's fields, while the
 * existing full-object edit dialog call site still type-checks unchanged.
 */
export function useUpdateProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ProspectInput> }) =>
      apiPut<ProspectDTO>(`/leads/prospects/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useDeleteProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/leads/prospects/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useScoreProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      apiPost<LeadScoreResult>(`/leads/prospects/${id}/score`, { force }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Feedback                                                           */
/* ------------------------------------------------------------------ */

export interface SubmitFeedbackInput {
  id: string;
  rating: FeedbackRating;
  comment?: string;
}

export function useSubmitFeedback(leadType: LeadType) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rating, comment }: SubmitFeedbackInput) =>
      apiPost<LeadScoreFeedbackDTO>(`/leads/${leadType}/${id}/feedback`, { rating, comment }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Summary + batch scoring                                            */
/* ------------------------------------------------------------------ */

export function useLeadsSummary() {
  return useQuery({
    queryKey: ["leads", "summary"],
    queryFn: () => apiGet<LeadSummaryDTO>("/leads/summary"),
    staleTime: 30_000,
  });
}

export function useScoreBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<unknown>("/leads/score-batch"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
}
