import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DailyPriorityLevel,
  OpportunityAccountsResponseDTO,
  OpportunityCategory,
  OpportunityQueryFilters,
  OpportunitySummaryDTO,
  OpportunityType,
  OverdueAccountsResponseDTO,
  OverdueAgeBucket,
  OverdueBillDetailResponseDTO,
  OverdueCustomerBillsResponseDTO,
  OverdueSort,
} from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";
import { LIVE_SHEET_REFETCH_MS } from "./use-fms";

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

export interface OpportunityAccountsParams {
  category: OpportunityCategory;
  page: number;
  pageSize: number;
  search?: string;
  opportunityType?: OpportunityType;
  priority?: DailyPriorityLevel;
}

/**
 * One Opportunity Center card's full list, paged and searched server-side
 * from the same snapshot as the card counts. Keeps the previous page on
 * screen while the next one loads.
 */
export function useOpportunityAccounts(params: OpportunityAccountsParams) {
  return useQuery({
    queryKey: [OPPORTUNITIES_KEY, "accounts", params],
    queryFn: () =>
      apiGet<OpportunityAccountsResponseDTO>("/sales-agent/opportunities/accounts", {
        type: params.category,
        page: params.page,
        pageSize: params.pageSize,
        search: params.search,
        opportunityType: params.opportunityType,
        priority: params.priority,
      }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export interface OverdueAccountsParams {
  page: number;
  pageSize: number;
  search?: string;
  age?: OverdueAgeBucket;
  sort?: OverdueSort;
}

/** Accounts with overdue payments (FMS payment sheet), paged/searched/sorted server-side. */
export function useOverdueAccounts(params: OverdueAccountsParams) {
  return useQuery({
    queryKey: [OPPORTUNITIES_KEY, "overdue", params],
    queryFn: () =>
      apiGet<OverdueAccountsResponseDTO>("/sales-agent/opportunities/overdue", {
        page: params.page,
        pageSize: params.pageSize,
        search: params.search,
        age: params.age,
        sort: params.sort,
      }),
    staleTime: 30_000,
    refetchInterval: LIVE_SHEET_REFETCH_MS,
    placeholderData: (prev) => prev,
  });
}

/** One overdue customer's bills (FMS payment sheet), paged server-side; keeps the previous page visible while the next loads. */
export function useOverdueCustomerBills(accountId: string, params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: [OPPORTUNITIES_KEY, "overdue", "bills", accountId, params],
    queryFn: () =>
      apiGet<OverdueCustomerBillsResponseDTO>(`/sales-agent/opportunities/overdue/${encodeURIComponent(accountId)}/bills`, {
        page: params.page,
        pageSize: params.pageSize,
      }),
    staleTime: 30_000,
    refetchInterval: LIVE_SHEET_REFETCH_MS,
    placeholderData: (prev) => prev,
  });
}

/** One bill's payment-sheet rows and synced FMS order. */
export function useOverdueBillDetail(billNo: string) {
  return useQuery({
    queryKey: [OPPORTUNITIES_KEY, "overdue", "bill", billNo],
    queryFn: () => apiGet<OverdueBillDetailResponseDTO>(`/sales-agent/opportunities/overdue/bills/${encodeURIComponent(billNo)}`),
    staleTime: 30_000,
    refetchInterval: LIVE_SHEET_REFETCH_MS,
  });
}
