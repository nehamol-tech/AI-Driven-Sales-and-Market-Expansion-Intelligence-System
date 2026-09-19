import { useQuery } from "@tanstack/react-query";
import type { FmsDataResponseDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

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
  });
}
