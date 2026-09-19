import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SalesRecordDTO } from "@ai-sales/shared";
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from "@/lib/api-client";
import type { PaginatedResponse } from "@/lib/types";

export interface SalesFilters {
  dateFrom?: string;
  dateTo?: string;
  stateId?: string;
  productId?: string;
  salespersonId?: string;
  page?: number;
  pageSize?: number;
}

export function useSalesRecords(filters: SalesFilters) {
  return useQuery({
    queryKey: ["sales", filters],
    queryFn: () =>
      apiGet<PaginatedResponse<SalesRecordDTO>>("/sales", {
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        stateId: filters.stateId,
        productId: filters.productId,
        salespersonId: filters.salespersonId,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
      }),
    placeholderData: (prev) => prev,
  });
}

export interface SalesRecordInput {
  date: string;
  productId?: string | null;
  customerName: string;
  stateId?: string | null;
  cityId?: string | null;
  industryId?: string | null;
  quantity: number;
  orderValue: string;
  salespersonId?: string | null;
  isNewCustomer: boolean;
  /** Phase 8: which Distributor (if any) this order is attributed to — feeds distributor-expansion.service.ts's totalRevenue/orderCount. */
  distributorId?: string | null;
}

export function useCreateSalesRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SalesRecordInput) => apiPost<SalesRecordDTO>("/sales", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateSalesRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SalesRecordInput }) =>
      apiPut<SalesRecordDTO>(`/sales/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteSalesRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/sales/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface ImportBatchStatus {
  batchId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  totalRows: number;
  successRows: number;
  failedRows: number;
  errors?: unknown;
}

export function useImportSalesCsv() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => apiUpload<ImportBatchStatus>("/sales/import", file, "file"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useImportBatchStatus(batchId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["sales", "import", batchId],
    queryFn: () => apiGet<ImportBatchStatus>(`/sales/import/${batchId}`),
    enabled: Boolean(batchId) && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "COMPLETED" || status === "FAILED") return false;
      return 1500;
    },
  });
}
