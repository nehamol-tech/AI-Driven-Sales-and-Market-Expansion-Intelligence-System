"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/toaster";
import { ApiError } from "@/lib/api-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status === 401) return false;
              if (error instanceof ApiError && error.status >= 400 && error.status < 500)
                return false;
              return failureCount < 2;
            },
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            // Keep data from pages visited earlier for 30 min (default 5): going back
            // to a page shows it instantly and refreshes it in the background
            // (once older than staleTime).
            gcTime: 30 * 60_000,
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
