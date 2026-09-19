import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanyDTO } from "@ai-sales/shared";
import { apiGet, apiPost, apiDelete, apiPut } from "@/lib/api-client";

export function useCompany() {
  return useQuery({
    queryKey: ["company"],
    queryFn: () => apiGet<CompanyDTO>("/company"),
    staleTime: 60_000,
  });
}

export interface UpdateCompanyInput {
  name: string;
  industry: string;
  description?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  headquartersStateId?: string | null;
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCompanyInput) => apiPut<CompanyDTO>("/company", input),
    onSuccess: (data) => {
      queryClient.setQueryData(["company"], data);
    },
  });
}

export function useAddOperatingState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stateId: string) =>
      apiPost<CompanyDTO>("/company/operating-states", { stateId }),
    onSuccess: (data) => queryClient.setQueryData(["company"], data),
  });
}

export function useRemoveOperatingState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stateId: string) =>
      apiDelete<CompanyDTO>("/company/operating-states", { stateId }),
    onSuccess: (data) => queryClient.setQueryData(["company"], data),
  });
}

export function useAddTargetState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ stateId, notes }: { stateId: string; notes?: string }) =>
      apiPost<CompanyDTO>("/company/target-states", { stateId, notes }),
    onSuccess: (data) => queryClient.setQueryData(["company"], data),
  });
}

export function useRemoveTargetState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stateId: string) =>
      apiDelete<CompanyDTO>("/company/target-states", { stateId }),
    onSuccess: (data) => queryClient.setQueryData(["company"], data),
  });
}
