import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdCampaignDTO,
  AdConnectionDTO,
  AdPlatform,
  AdSpendRecordDTO,
  AdvertisingSummaryDTO,
} from "@ai-sales/shared";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import type { PaginatedResponse } from "@/lib/types";

const ADVERTISING_CONNECTIONS_KEY = "advertising-connections" as const;
const ADVERTISING_CAMPAIGNS_KEY = "advertising-campaigns" as const;
const ADVERTISING_SPEND_KEY = "advertising-spend" as const;
const ADVERTISING_ANALYTICS_KEY = "advertising-analytics" as const;

/* ------------------------------------------------------------------ */
/* Connections                                                        */
/* ------------------------------------------------------------------ */

/**
 * Always resolves to exactly two entries (META, GOOGLE) per the verified
 * live API contract — `status: "DISCONNECTED"` for a platform the company
 * has never connected, never a missing array entry. Open to every role.
 */
export function useAdConnections() {
  return useQuery({
    queryKey: [ADVERTISING_CONNECTIONS_KEY],
    queryFn: () => apiGet<{ data: AdConnectionDTO[] }>("/advertising/connections").then((r) => r.data),
  });
}

export interface AuthorizeResult {
  configured: boolean;
  url?: string;
  message?: string;
}

/**
 * ADMIN only server-side (403 otherwise) — UI hides the Connect action for
 * other roles as a convenience. When `configured` is false (currently true
 * for both platforms in this environment — no real credentials exist), this
 * is a normal 200 response, not a mutation failure; the caller should render
 * `message` rather than treat it as an error. When `configured` is true and
 * a `url` comes back, the real behavior is `window.location.href = url`.
 */
export function useConnectPlatform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (platform: AdPlatform) =>
      apiPost<AuthorizeResult>(`/advertising/connections/${platform}/authorize`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ADVERTISING_CONNECTIONS_KEY] }),
  });
}

/** ADMIN only server-side (403 otherwise) — UI hides the Disconnect action for other roles. */
export function useDisconnectPlatform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (platform: AdPlatform) =>
      apiDelete<AdConnectionDTO>(`/advertising/connections/${platform}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ADVERTISING_CONNECTIONS_KEY] }),
  });
}

export interface SyncResult {
  configured: boolean;
  message?: string;
  campaignsSynced?: number;
  spendRecordsSynced?: number;
  errors?: string[];
}

/**
 * ADMIN/MANAGER only server-side (403 for SALES_USER) — UI hides the Sync
 * action for other roles. Pulls real campaigns/spend from the connected
 * platform, so a successful sync should refresh both the campaigns list and
 * the connection's lastSyncedAt.
 */
export function useSyncPlatform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (platform: AdPlatform) =>
      apiPost<SyncResult>(`/advertising/connections/${platform}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADVERTISING_CONNECTIONS_KEY] });
      queryClient.invalidateQueries({ queryKey: [ADVERTISING_CAMPAIGNS_KEY] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Campaigns                                                          */
/* ------------------------------------------------------------------ */

export interface AdCampaignFilters {
  platform?: AdPlatform;
  isActive?: boolean;
}

/** Open to every role. Fetched with a large pageSize since the /advertising page renders the full campaign list, not a paginated table (mirrors useProducts' pageSize:100 convention for small reference lists). */
export function useAdCampaigns(filters: AdCampaignFilters = {}) {
  return useQuery({
    queryKey: [ADVERTISING_CAMPAIGNS_KEY, filters],
    queryFn: () =>
      apiGet<PaginatedResponse<AdCampaignDTO>>("/advertising/campaigns", {
        platform: filters.platform,
        isActive: filters.isActive,
        pageSize: 100,
      }),
  });
}

export interface AdCampaignInput {
  name: string;
  platform: AdPlatform;
  startDate: string;
  endDate?: string | null;
  isActive?: boolean;
}

/** Open to every role — mirrors how any role can log a Sales record or create a Prospect. */
export function useCreateAdCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdCampaignInput) => apiPost<AdCampaignDTO>("/advertising/campaigns", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ADVERTISING_CAMPAIGNS_KEY] }),
  });
}

export function useUpdateAdCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<AdCampaignInput> }) =>
      apiPut<AdCampaignDTO>(`/advertising/campaigns/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ADVERTISING_CAMPAIGNS_KEY] }),
  });
}

/** ADMIN/MANAGER only server-side (403 for SALES_USER) — UI hides this action entirely for SALES_USER, matching Prospect/FollowUp's delete precedent. */
export function useDeleteAdCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/advertising/campaigns/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ADVERTISING_CAMPAIGNS_KEY] }),
  });
}

/* ------------------------------------------------------------------ */
/* Spend records                                                      */
/* ------------------------------------------------------------------ */

/** Open to every role. */
export function useSpendRecords(campaignId: string | null | undefined) {
  return useQuery({
    queryKey: [ADVERTISING_SPEND_KEY, campaignId],
    queryFn: () =>
      apiGet<{ data: AdSpendRecordDTO[] }>(`/advertising/campaigns/${campaignId}/spend`).then(
        (r) => r.data
      ),
    enabled: Boolean(campaignId),
  });
}

export interface SpendRecordInput {
  date: string;
  amount: string;
  impressions?: number | null;
  clicks?: number | null;
}

/**
 * Open to every role. Analytics (totalSpend/costPerLead/etc.) has its own
 * daily cache server-side, so a freshly logged spend record won't be
 * reflected there until a force=true regenerate — callers should surface
 * that honestly (e.g. a toast) rather than pretending the new number is
 * already live.
 */
export function useCreateSpendRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, input }: { campaignId: string; input: SpendRecordInput }) =>
      apiPost<AdSpendRecordDTO>(`/advertising/campaigns/${campaignId}/spend`, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [ADVERTISING_SPEND_KEY, variables.campaignId] });
      queryClient.invalidateQueries({ queryKey: [ADVERTISING_CAMPAIGNS_KEY] });
    },
  });
}

/** ADMIN/MANAGER only server-side (403 for SALES_USER) — UI hides this action entirely for SALES_USER. */
export function useDeleteSpendRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, spendId }: { campaignId: string; spendId: string }) =>
      apiDelete<void>(`/advertising/campaigns/${campaignId}/spend/${spendId}`),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [ADVERTISING_SPEND_KEY, variables.campaignId] });
      queryClient.invalidateQueries({ queryKey: [ADVERTISING_CAMPAIGNS_KEY] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Analytics                                                          */
/* ------------------------------------------------------------------ */

/**
 * Fetches the advertising summary (live connections + daily-cached campaign
 * analytics + narrative). Mirrors useRevenueAnalytics.
 */
export function useAdvertisingAnalytics() {
  return useQuery({
    queryKey: [ADVERTISING_ANALYTICS_KEY],
    queryFn: () => apiGet<AdvertisingSummaryDTO>("/advertising/analytics"),
    staleTime: 30_000,
  });
}

/**
 * Regenerates advertising analytics, bypassing the cache. ADMIN/MANAGER
 * only — the backend returns 403 for other roles (mirrors
 * useRegenerateRevenueAnalytics exactly).
 */
export function useRegenerateAdvertisingAnalytics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiGet<AdvertisingSummaryDTO>("/advertising/analytics", { force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData([ADVERTISING_ANALYTICS_KEY], data);
    },
  });
}
