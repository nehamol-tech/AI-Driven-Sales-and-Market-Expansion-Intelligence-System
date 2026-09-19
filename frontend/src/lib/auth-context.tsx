"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserDTO } from "@ai-sales/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";

interface AuthContextValue {
  user: UserDTO | null;
  isLoading: boolean;
  error: ApiError | null;
  login: (email: string, password: string) => Promise<UserDTO>;
  logout: () => Promise<void>;
  refetch: () => Promise<unknown>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(
  undefined
);

async function fetchMe(): Promise<UserDTO | null> {
  try {
    return await apiGet<UserDTO>("/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });

  const login = React.useCallback(
    async (email: string, password: string) => {
      const user = await apiPost<UserDTO>("/auth/login", { email, password });
      queryClient.setQueryData(["me"], user);
      return user;
    },
    [queryClient]
  );

  const logout = React.useCallback(async () => {
    await apiPost("/auth/logout");
    queryClient.setQueryData(["me"], null);
    queryClient.clear();
  }, [queryClient]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user: data ?? null,
      isLoading,
      error: error instanceof ApiError ? error : null,
      login,
      logout,
      refetch,
    }),
    [data, isLoading, error, login, logout, refetch]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
