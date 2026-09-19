import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductDTO } from "@ai-sales/shared";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import type { PaginatedResponse } from "@/lib/types";

export interface ProductFilters {
  search?: string;
  category?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export function useProducts(filters: ProductFilters) {
  return useQuery({
    queryKey: ["products", filters],
    queryFn: () =>
      apiGet<PaginatedResponse<ProductDTO>>("/products", {
        search: filters.search,
        category: filters.category,
        isActive: filters.isActive,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
      }),
    placeholderData: (prev) => prev,
  });
}

export interface ProductInput {
  name: string;
  sku: string;
  category?: string | null;
  description?: string | null;
  price: string;
  minOrderQty: number;
  availableQty: number;
  keywords: string[];
  isActive: boolean;
  targetIndustryIds: string[];
  targetBusinessTypeIds: string[];
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) => apiPost<ProductDTO>("/products", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProductInput }) =>
      apiPut<ProductDTO>(`/products/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/products/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}
