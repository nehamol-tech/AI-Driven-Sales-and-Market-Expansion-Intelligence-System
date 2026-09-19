import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role, UserDTO } from "@ai-sales/shared";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<UserDTO[]>("/users"),
    staleTime: 30_000,
  });
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => apiPost<UserDTO>("/users", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export interface UpdateUserInput {
  role?: Role;
  isActive?: boolean;
  name?: string;
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      apiPatch<UserDTO>(`/users/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
