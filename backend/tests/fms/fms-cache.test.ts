import { describe, it, expect, vi } from "vitest";
import type { FetchFmsDataParams, FetchFmsDataResult, FmsClient } from "../../src/modules/fms/fms.client.js";
import { CachedFmsClient } from "../../src/modules/fms/fms-cache.js";

function ok(sheet: string, marker: string): FetchFmsDataResult {
  return { status: "ok", body: { success: true, sheet, count: 1, totalRows: 1, data: [{ v: marker }] } };
}

/** A fake Apps Script client whose responses are released manually, to observe in-flight behaviour. */
function controllableClient() {
  const pending: { params: FetchFmsDataParams; resolve: (r: FetchFmsDataResult) => void }[] = [];
  const fetchData = vi.fn(
    (params: FetchFmsDataParams) => new Promise<FetchFmsDataResult>((resolve) => pending.push({ params, resolve })),
  );
  return { client: { fetchData } as FmsClient, fetchData, pending };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("CachedFmsClient", () => {
  it("serves a fresh entry from memory without calling the Apps Script again", async () => {
    let now = 0;
    const inner = { fetchData: vi.fn(async (p: FetchFmsDataParams) => ok(p.sheet!, "a")) };
    const cache = new CachedFmsClient(inner, { freshMs: 1000, now: () => now });

    const first = await cache.fetchData({ sheet: "Data", limit: 20 });
    now = 999;
    const second = await cache.fetchData({ sheet: "Data", limit: 20 });

    expect(inner.fetchData).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first).toMatchObject({ status: "ok", fetchedAt: new Date(0).toISOString() });
  });

  it("keys on the exact sheet + limit pair", async () => {
    const inner = { fetchData: vi.fn(async (p: FetchFmsDataParams) => ok(p.sheet!, String(p.limit))) };
    const cache = new CachedFmsClient(inner);
    await cache.fetchData({ sheet: "FMS", limit: 10 });
    await cache.fetchData({ sheet: "FMS", limit: 10000 });
    await cache.fetchData({ sheet: "Data", limit: 10 });
    expect(inner.fetchData).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight Apps Script call between concurrent identical requests", async () => {
    const { client, fetchData, pending } = controllableClient();
    const cache = new CachedFmsClient(client);

    const a = cache.fetchData({ sheet: "FMS", limit: 10 });
    const b = cache.fetchData({ sheet: "FMS", limit: 10 });
    expect(fetchData).toHaveBeenCalledTimes(1);

    pending[0].resolve(ok("FMS", "x"));
    expect(await a).toBe(await b);
  });

  it("serves a stale entry immediately and refreshes it in the background", async () => {
    let now = 0;
    const { client, fetchData, pending } = controllableClient();
    const cache = new CachedFmsClient(client, { freshMs: 1000, now: () => now });

    const firstCall = cache.fetchData({ sheet: "Data" });
    pending[0].resolve(ok("Data", "old"));
    const old = await firstCall;

    now = 5000;
    const stale = await cache.fetchData({ sheet: "Data" });
    expect(stale).toBe(old);
    expect(fetchData).toHaveBeenCalledTimes(2);

    pending[1].resolve(ok("Data", "new"));
    await flush();
    const refreshed = await cache.fetchData({ sheet: "Data" });
    expect(refreshed).toMatchObject({ body: { data: [{ v: "new" }] }, fetchedAt: new Date(5000).toISOString() });
  });

  it("never caches a failure: with no previous data the error is returned and the next call retries", async () => {
    const inner = {
      fetchData: vi
        .fn<(p: FetchFmsDataParams) => Promise<FetchFmsDataResult>>()
        .mockResolvedValueOnce({ status: "network_error", message: "HTTP 500" })
        .mockResolvedValueOnce(ok("FMS", "ok")),
    };
    const cache = new CachedFmsClient(inner);
    expect(await cache.fetchData({ sheet: "FMS" })).toEqual({ status: "network_error", message: "HTTP 500" });
    expect(await cache.fetchData({ sheet: "FMS" })).toMatchObject({ status: "ok" });
  });

  it("keeps serving the last good response when a refresh fails", async () => {
    let now = 0;
    const inner = {
      fetchData: vi
        .fn<(p: FetchFmsDataParams) => Promise<FetchFmsDataResult>>()
        .mockResolvedValueOnce(ok("FMS", "good"))
        .mockResolvedValue({ status: "upstream_rejected", error: "Sheet not allowed", allowedSheets: null }),
    };
    const cache = new CachedFmsClient(inner, { freshMs: 1000, now: () => now });
    const good = await cache.fetchData({ sheet: "FMS" });
    now = 5000;
    await cache.fetchData({ sheet: "FMS" });
    await flush();
    expect(await cache.fetchData({ sheet: "FMS" })).toBe(good);
  });

  it("returns a network_error rather than throwing if the inner client throws", async () => {
    const cache = new CachedFmsClient({ fetchData: async () => Promise.reject(new Error("socket hang up")) });
    expect(await cache.fetchData({ sheet: "FMS" })).toEqual({ status: "network_error", message: "socket hang up" });
  });

  it("warm() pre-loads the given requests so the first real request is served from memory", async () => {
    const inner = { fetchData: vi.fn(async (p: FetchFmsDataParams) => ok(p.sheet!, "w")) };
    const cache = new CachedFmsClient(inner);
    await cache.warm([{ sheet: "Data", limit: 20 }, { sheet: "FMS", limit: 10 }]);
    await cache.fetchData({ sheet: "Data", limit: 20 });
    expect(inner.fetchData).toHaveBeenCalledTimes(2);
  });

  it("refreshActive() refreshes only stale entries that were requested recently", async () => {
    let now = 0;
    const inner = { fetchData: vi.fn(async (p: FetchFmsDataParams) => ok(p.sheet!, String(now))) };
    const cache = new CachedFmsClient(inner, { freshMs: 1000, activeWindowMs: 10_000, now: () => now });
    await cache.fetchData({ sheet: "Active" });
    await cache.fetchData({ sheet: "Idle" });

    now = 9_000;
    await cache.fetchData({ sheet: "Active" }); // stale → also triggers its own background refresh
    await flush();
    inner.fetchData.mockClear();

    now = 15_000;
    await cache.refreshActive();
    expect(inner.fetchData.mock.calls.map((c) => c[0].sheet)).toEqual(["Active"]);
  });

  it("only ever calls the wrapped client's fetchData (the GET-only path)", () => {
    expect(Object.getOwnPropertyNames(CachedFmsClient.prototype).sort()).toEqual(
      ["constructor", "fetchData", "load", "refreshActive", "warm"].sort(),
    );
  });
});

describe("getFmsData with a cached response", () => {
  it("reports the cached response's fetchedAt instead of the request time", async () => {
    const { getFmsData } = await import("../../src/modules/fms/fms.service.js");
    const client: FmsClient = { fetchData: async () => ({ ...ok("Data", "x"), fetchedAt: "2026-10-27T05:00:00.000Z" }) };
    const result = await getFmsData(client, { sheet: "Data" });
    expect(result).toMatchObject({ status: "ok", dto: { fetchedAt: "2026-10-27T05:00:00.000Z" } });
  });
});
