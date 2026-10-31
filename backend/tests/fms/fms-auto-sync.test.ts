import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FmsOrderHistorySyncResult } from "../../src/modules/fms/fms-order-history-sync.service.js";

const syncFmsOrderHistory = vi.fn();
vi.mock("../../src/modules/fms/fms-order-history-sync.service.js", () => ({
  syncFmsOrderHistory: (...args: unknown[]) => syncFmsOrderHistory(...args),
  syncChangedData: (r: FmsOrderHistorySyncResult) => !r.dryRun && r.rowsSynced + r.rowsUpdated + r.rowsRenumbered + r.rowsMarkedCancelled + r.rowsSuperseded > 0,
}));
const logAudit = vi.fn(async () => {});
vi.mock("../../src/modules/audit/audit.service.js", () => ({ logAudit: (...args: unknown[]) => logAudit(...(args as [])) }));
const clearOpportunitiesCache = vi.fn();
vi.mock("../../src/modules/opportunities/opportunities.service.js", () => ({ clearOpportunitiesCache: () => clearOpportunitiesCache() }));

const { runFmsHistorySyncExclusive, runAutoSyncOnce, startFmsAutoSync, resolveAutoSyncCompanyId, FmsSyncInProgressError } = await import(
  "../../src/modules/fms/fms-auto-sync.js"
);

const { env } = await import("../../src/config/env.js");
const client = { fetchData: vi.fn() };
const prisma = {} as never;

function result(overrides: Partial<FmsOrderHistorySyncResult> = {}): FmsOrderHistorySyncResult {
  return {
    dryRun: false,
    rowsFetched: 3,
    rowsSynced: 0,
    rowsUpdated: 0,
    rowsRestored: 0,
    rowsRenumbered: 0,
    rowsSuperseded: 0,
    rowsReconciledToExisting: 0,
    rowsSkippedDuplicate: 3,
    rowsFailed: 0,
    rowsMarkedCancelled: 0,
    rowsAlreadyCancelled: 0,
    rowsCancelledNotImported: 0,
    rowsMissingFromSheet: 0,
    errors: [],
    accountsCreated: 0,
    accountsResolved: 0,
    changes: { inserted: [], updated: [], renumbered: [], cancelled: [], superseded: [], missingFromSheet: [] },
    durationMs: 1,
    ...overrides,
  };
}

function fakeLock(acquire = true) {
  return { tryAcquire: vi.fn(async () => acquire), release: vi.fn(async () => {}) };
}

beforeEach(() => {
  syncFmsOrderHistory.mockReset();
  logAudit.mockClear();
  clearOpportunitiesCache.mockClear();
});

describe("runFmsHistorySyncExclusive", () => {
  it("runs under the lock and releases it", async () => {
    syncFmsOrderHistory.mockResolvedValue(result());
    const lock = fakeLock();
    await runFmsHistorySyncExclusive(client, "c1", { prisma, lock });
    expect(lock.tryAcquire).toHaveBeenCalledTimes(1);
    expect(syncFmsOrderHistory).toHaveBeenCalledWith(prisma, client, "c1", { applyAdjustments: env.FMS_NEGATIVE_ADJUSTMENTS_ENABLED }); // default comes from the setting
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it("refuses to run when another process holds the lock", async () => {
    const lock = fakeLock(false);
    await expect(runFmsHistorySyncExclusive(client, "c1", { prisma, lock })).rejects.toBeInstanceOf(FmsSyncInProgressError);
    expect(syncFmsOrderHistory).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it("refuses a second run in the same process while one is in progress", async () => {
    let finish!: (r: FmsOrderHistorySyncResult) => void;
    syncFmsOrderHistory.mockReturnValue(new Promise((r) => (finish = r)));
    const lock = fakeLock();
    const first = runFmsHistorySyncExclusive(client, "c1", { prisma, lock });
    await expect(runFmsHistorySyncExclusive(client, "c1", { prisma, lock })).rejects.toBeInstanceOf(FmsSyncInProgressError);
    finish(result());
    await first;
    expect(syncFmsOrderHistory).toHaveBeenCalledTimes(1);
    // free again afterwards
    syncFmsOrderHistory.mockResolvedValue(result());
    await expect(runFmsHistorySyncExclusive(client, "c1", { prisma, lock })).resolves.toBeDefined();
  });

  it("releases the lock even when the sync fails", async () => {
    syncFmsOrderHistory.mockRejectedValue(new Error("HTTP 500"));
    const lock = fakeLock();
    await expect(runFmsHistorySyncExclusive(client, "c1", { prisma, lock })).rejects.toThrow("HTTP 500");
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it("clears the report caches only when the run changed data", async () => {
    const lock = fakeLock();
    syncFmsOrderHistory.mockResolvedValue(result());
    await runFmsHistorySyncExclusive(client, "c1", { prisma, lock });
    expect(clearOpportunitiesCache).not.toHaveBeenCalled();
    syncFmsOrderHistory.mockResolvedValue(result({ rowsMarkedCancelled: 1 }));
    await runFmsHistorySyncExclusive(client, "c1", { prisma, lock });
    expect(clearOpportunitiesCache).toHaveBeenCalledTimes(1);
  });

  it("a dry run takes no lock and passes dryRun through", async () => {
    syncFmsOrderHistory.mockResolvedValue(result({ dryRun: true }));
    const lock = fakeLock();
    await runFmsHistorySyncExclusive(client, "c1", { prisma, lock, dryRun: true });
    expect(lock.tryAcquire).not.toHaveBeenCalled();
    expect(syncFmsOrderHistory).toHaveBeenCalledWith(prisma, client, "c1", { dryRun: true, applyAdjustments: env.FMS_NEGATIVE_ADJUSTMENTS_ENABLED });
    await runFmsHistorySyncExclusive(client, "c1", { prisma, lock, dryRun: true, applyAdjustments: true });
    expect(syncFmsOrderHistory).toHaveBeenLastCalledWith(prisma, client, "c1", { dryRun: true, applyAdjustments: true });
  });
});

describe("runAutoSyncOnce", () => {
  it("never throws, and audits only runs that changed data", async () => {
    syncFmsOrderHistory.mockResolvedValue(result());
    await runAutoSyncOnce(client, "c1", { prisma, lock: fakeLock() });
    expect(logAudit).not.toHaveBeenCalled();

    syncFmsOrderHistory.mockResolvedValue(result({ rowsUpdated: 2 }));
    await runAutoSyncOnce(client, "c1", { prisma, lock: fakeLock() });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "FMS_ORDER_HISTORY_AUTO_SYNCED", userId: null }));

    syncFmsOrderHistory.mockRejectedValue(new Error("HTTP 500"));
    await expect(runAutoSyncOnce(client, "c1", { prisma, lock: fakeLock() })).resolves.toBeUndefined();
    await expect(runAutoSyncOnce(client, "c1", { prisma, lock: fakeLock(false) })).resolves.toBeUndefined();
  });
});

describe("startFmsAutoSync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs after the initial delay, then each interval after the previous run finishes — never overlapping", async () => {
    let active = 0;
    let maxActive = 0;
    const run = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 3 * 60_000)); // a slow run (3 min)
      active -= 1;
    });
    const scheduler = startFmsAutoSync({ intervalMs: 5 * 60_000, initialDelayMs: 60_000, run });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 5 * 60_000 - 1); // run finishes at +3 min; next starts 5 min later
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("resolveAutoSyncCompanyId", () => {
  const deps = (companies: { id: string }[]) =>
    ({
      company: {
        findUnique: async ({ where }: { where: { id: string } }) => companies.find((c) => c.id === where.id) ?? null,
        findMany: async () => companies.slice(0, 2),
      },
    }) as never;

  it("uses the configured company when it exists, otherwise the only company", async () => {
    expect(await resolveAutoSyncCompanyId(deps([{ id: "c1" }, { id: "c2" }]), "c2")).toBe("c2");
    expect(await resolveAutoSyncCompanyId(deps([{ id: "c1" }]), "missing")).toBeNull();
    expect(await resolveAutoSyncCompanyId(deps([{ id: "c1" }]), undefined)).toBe("c1");
  });

  it("returns null when several companies exist and none is configured", async () => {
    expect(await resolveAutoSyncCompanyId(deps([{ id: "c1" }, { id: "c2" }]), undefined)).toBeNull();
  });
});
