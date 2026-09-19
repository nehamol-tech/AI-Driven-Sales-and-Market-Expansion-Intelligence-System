import { useQuery } from "@tanstack/react-query";
import type { StateDTO, CityDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

export function useStates() {
  return useQuery({
    queryKey: ["states"],
    queryFn: () => apiGet<StateDTO[]>("/states"),
    staleTime: 5 * 60_000,
  });
}

export function useCities(stateId: string | null | undefined) {
  return useQuery({
    queryKey: ["states", stateId, "cities"],
    queryFn: () => apiGet<CityDTO[]>(`/states/${stateId}/cities`),
    enabled: Boolean(stateId),
    staleTime: 5 * 60_000,
  });
}
