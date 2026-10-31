import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({ apiGet: vi.fn(() => new Promise(() => {})), apiPost: vi.fn(), ApiError: class extends Error {} }));

const { LIVE_SHEET_REFETCH_MS, useFmsData, useFmsFulfilment } = await import("@/hooks/use-fms");
const { useOverdueAccounts, useOpportunityAccounts, useOpportunities } = await import("@/hooks/use-opportunities");

/** Renders `useHook` once and returns the options React Query registered for its query. */
function optionsOf(useHook: () => unknown, queryKey: unknown[]) {
  const client = new QueryClient();
  function Probe() {
    useHook();
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  const query = client.getQueryCache().find({ queryKey, exact: true });
  if (!query) throw new Error(`query ${JSON.stringify(queryKey)} not registered`);
  return query.observers[0]?.options ?? (query.options as Record<string, unknown>);
}

describe("live Google Sheet queries poll every 60 s", () => {
  it("uses a 60-second interval", () => {
    expect(LIVE_SHEET_REFETCH_MS).toBe(60_000);
  });

  it("polls FMS data, Order Fulfilment and Overdue with their existing keys", () => {
    const overdue = { page: 1, pageSize: 25, sort: "amount" as const };
    const cases: [() => unknown, unknown[]][] = [
      [() => useFmsData({ sheet: "FMS", limit: 10 }), ["fms", "data", "FMS", 10]],
      [() => useFmsFulfilment({ page: 1, pageSize: 25 }), ["fms", "fulfilment", 1, 25]],
      [() => useOverdueAccounts(overdue), ["opportunities", "overdue", overdue]],
    ];
    for (const [hook, key] of cases) {
      const options = optionsOf(hook, key) as { refetchInterval?: unknown; staleTime?: unknown };
      expect(options.refetchInterval).toBe(60_000);
      expect(options.staleTime).toBe(30_000);
    }
  });

  it("does not poll database-backed queries", () => {
    const params = { category: "REORDER" as const, page: 1, pageSize: 25 };
    expect((optionsOf(() => useOpportunityAccounts(params), ["opportunities", "accounts", params]) as { refetchInterval?: unknown }).refetchInterval).toBeUndefined();
    const summary = optionsOf(() => useOpportunities(), ["opportunities", {}]) as { refetchInterval?: unknown };
    expect(summary.refetchInterval).toBeUndefined();
  });
});
