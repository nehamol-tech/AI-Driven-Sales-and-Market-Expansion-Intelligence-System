import { useQuery } from "@tanstack/react-query";
import type { IndustryDTO, BusinessTypeDTO } from "@ai-sales/shared";
import { apiGet } from "@/lib/api-client";

export function useIndustries() {
  return useQuery({
    queryKey: ["industries"],
    queryFn: () => apiGet<IndustryDTO[]>("/industries"),
    staleTime: 5 * 60_000,
  });
}

export function useBusinessTypes() {
  return useQuery({
    queryKey: ["business-types"],
    queryFn: () => apiGet<BusinessTypeDTO[]>("/business-types"),
    staleTime: 5 * 60_000,
  });
}
