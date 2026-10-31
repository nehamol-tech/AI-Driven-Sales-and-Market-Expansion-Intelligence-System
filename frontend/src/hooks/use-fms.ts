import { useQuery } from "@tanstack/react-query";
import type { FmsDataResponseDTO, FmsFulfilmentResponseDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

/**
 * Refetch interval for queries that read live Google Sheet data (FMS data,
 * Order Fulfilment, Overdue), so an open page picks up new sheet rows.
 * React Query pauses it while the browser tab is hidden. The backend's sheet
 * cache (backend/src/modules/fms/fms-cache.ts) answers these refetches, so
 * they add no extra Apps Script calls.
 */
export const LIVE_SHEET_REFETCH_MS = 60_000;

/**
 * Calls only GET /api/fms/data on our own backend — the browser never sees
 * FMS_API_URL or talks to script.google.com directly (see
 * backend/src/modules/fms/fms.client.ts, the only place that URL is used).
 * Returns the raw FmsDataResponseDTO exactly as the backend sent it; no
 * column renaming/interpretation happens on the frontend either.
 */
export function useFmsData(params: { sheet?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: ["fms", "data", params.sheet ?? null, params.limit ?? null],
    queryFn: () => apiGet<FmsDataResponseDTO>("/fms/data", { sheet: params.sheet, limit: params.limit }),
    staleTime: 30_000,
    refetchInterval: LIVE_SHEET_REFETCH_MS,
  });
}

/**
 * GET /api/fms/fulfilment — read-only fulfilment steps from the FMS sheet,
 * joined server-side to already-synced sales records. Keeps the previous
 * page visible while the next one loads.
 */
export function useFmsFulfilment(params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: ["fms", "fulfilment", params.page, params.pageSize],
    queryFn: () => apiGet<FmsFulfilmentResponseDTO>("/fms/fulfilment", { page: params.page, pageSize: params.pageSize }),
    staleTime: 30_000,
    refetchInterval: LIVE_SHEET_REFETCH_MS,
    placeholderData: (prev) => prev,
  });
}
