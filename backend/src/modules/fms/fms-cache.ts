import { logger } from "../../lib/logger.js";
import type { FetchFmsDataParams, FetchFmsDataResult, FmsClient } from "./fms.client.js";

type OkResult = Extract<FetchFmsDataResult, { status: "ok" }>;

interface CacheEntry {
  result: OkResult;
  fetchedAtMs: number;
  params: FetchFmsDataParams;
  lastRequestedMs: number;
}

export interface CachedFmsClientOptions {
  /** How long a response is served without triggering a background refresh. */
  freshMs?: number;
  /** Keys requested within this window are kept warm by refreshActive(). */
  activeWindowMs?: number;
  now?: () => number;
}

/**
 * Read-through cache in front of the FMS Apps Script client.
 *
 * Why: the Apps Script reads its whole sheet on every call — measured live,
 * the 50,500-row "FMS" sheet takes ~24 s even for `limit=10` and ~80 s for
 * 10,000 rows, and every call costs ~2–3 s minimum. It can't be changed, so
 * dashboard requests must not wait on it.
 *
 * Behaviour (per exact sheet+limit pair — no slicing or re-interpretation
 * of the Apps Script's own `limit` semantics):
 * - fresh entry → served from memory;
 * - stale entry → served from memory immediately, refreshed in the
 *   background (stale-while-revalidate);
 * - no entry → fetched, and concurrent identical requests share that one
 *   in-flight call;
 * - failures are never cached — the last good response keeps being served
 *   and the failure is logged.
 * Every cached result carries `fetchedAt`, the time the Apps Script actually
 * answered, so callers report true data age instead of "now".
 *
 * Read-only: it only ever calls the wrapped client's GET-only fetchData.
 */
export class CachedFmsClient implements FmsClient {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<FetchFmsDataResult>>();
  private readonly freshMs: number;
  private readonly activeWindowMs: number;
  private readonly now: () => number;

  constructor(
    private readonly inner: FmsClient,
    options: CachedFmsClientOptions = {},
  ) {
    this.freshMs = options.freshMs ?? 5 * 60_000;
    this.activeWindowMs = options.activeWindowMs ?? 30 * 60_000;
    this.now = options.now ?? Date.now;
  }

  private static key(params: FetchFmsDataParams): string {
    return JSON.stringify([params.sheet ?? null, params.limit ?? null]);
  }

  async fetchData(params: FetchFmsDataParams): Promise<FetchFmsDataResult> {
    const key = CachedFmsClient.key(params);
    const entry = this.entries.get(key);
    if (entry) {
      entry.lastRequestedMs = this.now();
      if (this.now() - entry.fetchedAtMs >= this.freshMs) void this.load(key, params);
      return entry.result;
    }
    return this.load(key, params);
  }

  /** Fetches from the Apps Script, de-duplicating concurrent calls for the same key. */
  private load(key: string, params: FetchFmsDataParams): Promise<FetchFmsDataResult> {
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.inner
      .fetchData(params)
      .then((result): FetchFmsDataResult => {
        if (result.status !== "ok") {
          const previous = this.entries.get(key);
          if (previous) {
            logger.warn("FMS refresh failed; continuing to serve the last good response", {
              sheet: params.sheet ?? null,
              status: result.status,
            });
            return previous.result;
          }
          return result;
        }
        const fetchedAtMs = this.now();
        const cached: OkResult = { ...result, fetchedAt: new Date(fetchedAtMs).toISOString() };
        this.entries.set(key, {
          result: cached,
          fetchedAtMs,
          params,
          lastRequestedMs: this.entries.get(key)?.lastRequestedMs ?? fetchedAtMs,
        });
        return cached;
      })
      .catch((err: unknown): FetchFmsDataResult => {
        const previous = this.entries.get(key);
        if (previous) return previous.result;
        return { status: "network_error", message: err instanceof Error ? err.message : "Unknown error contacting the FMS API" };
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, promise);
    return promise;
  }

  /** Loads the given requests into the cache without anyone waiting on them (used at server start). */
  async warm(paramsList: FetchFmsDataParams[]): Promise<void> {
    for (const params of paramsList) await this.load(CachedFmsClient.key(params), params);
  }

  /**
   * Refreshes, one at a time, every stale entry that was requested within the
   * active window — so pages people are using stay fresh, while nothing runs
   * against the Apps Script once the dashboard is idle.
   */
  async refreshActive(): Promise<void> {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.lastRequestedMs > this.activeWindowMs) continue;
      if (now - entry.fetchedAtMs < this.freshMs) continue;
      await this.load(key, entry.params);
    }
  }
}
