import { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { logAudit } from "../audit/audit.service.js";
import { clearAdvertisingAnalyticsCache } from "../advertising/advertising-analytics.service.js";
import { clearDistributorExpansionCache } from "../distributors/distributor-expansion.service.js";
import { clearMarketExpansionCache } from "../market-expansion/market-expansion.service.js";
import { clearOpportunitiesCache } from "../opportunities/opportunities.service.js";
import { clearRevenueAnalyticsCache } from "../revenue-analytics/revenue-analytics.service.js";
import { clearSalesAgentCache } from "../sales-agent/sales-agent.service.js";
import type { FmsClient } from "./fms.client.js";
import { getFmsClient } from "./fms-client.factory.js";
import { syncChangedData, syncFmsOrderHistory, type FmsOrderHistorySyncResult } from "./fms-order-history-sync.service.js";

/**
 * Automatic FMS → database sync: runs the "FMS Response" history sync
 * (fms-order-history-sync.service.ts) on a timer, so new, edited and
 * cancelled bills reach the dashboard without anyone running an import.
 * The dashboard keeps reading only the database; page loads never sync.
 *
 * Exactly one sync runs at a time — automatic or the manual
 * POST /api/fms/sync-history — within this process (a flag) and across
 * backend processes (a Postgres advisory lock). A run that can't get both is
 * skipped, never queued.
 */

/** Arbitrary, fixed advisory-lock key for "FMS history sync". */
export const FMS_SYNC_LOCK_KEY = 7_301_726_001;

export class FmsSyncInProgressError extends Error {
  constructor() {
    super("An FMS sync is already running; try again shortly.");
    this.name = "FmsSyncInProgressError";
  }
}

export interface SyncLock {
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
}

/**
 * Session-level Postgres advisory lock on its own single-connection client,
 * so acquire and release always run on the same connection (the app's
 * pooled client can't guarantee that). If the process dies, its connection
 * closes and Postgres frees the lock.
 */
export function postgresAdvisoryLock(databaseUrl: string, key = FMS_SYNC_LOCK_KEY): SyncLock {
  let client: PrismaClient | null = null;
  const connect = () => {
    if (!client) {
      const url = new URL(databaseUrl);
      url.searchParams.set("connection_limit", "1");
      client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    }
    return client;
  };
  return {
    async tryAcquire() {
      const rows = await connect().$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${key}::bigint) AS locked`;
      return rows[0]?.locked === true;
    },
    async release() {
      await connect().$queryRaw`SELECT pg_advisory_unlock(${key}::bigint)`;
    },
  };
}

let defaultLock: SyncLock | null = null;
const getDefaultLock = () => (defaultLock ??= postgresAdvisoryLock(env.DATABASE_URL));

/** The daily-cached report pages, recomputed from the database on their next load once a sync changed it. */
export function clearSalesDerivedCaches(): void {
  clearOpportunitiesCache();
  clearRevenueAnalyticsCache();
  clearSalesAgentCache();
  clearMarketExpansionCache();
  clearDistributorExpansionCache();
  clearAdvertisingAnalyticsCache();
}

let running = false;

export interface ExclusiveSyncOptions {
  prisma?: PrismaClient;
  lock?: SyncLock;
  dryRun?: boolean;
  /** Fold negative adjustment rows into their bill (default: FMS_NEGATIVE_ADJUSTMENTS_ENABLED). */
  applyAdjustments?: boolean;
}

/**
 * Runs the history sync with the one-at-a-time guarantee, and clears the
 * report caches when it changed data. Throws FmsSyncInProgressError when
 * another run holds the flag or the lock. A dry run writes nothing and takes
 * no lock.
 */
export async function runFmsHistorySyncExclusive(
  client: FmsClient,
  companyId: string,
  options: ExclusiveSyncOptions = {},
): Promise<FmsOrderHistorySyncResult> {
  const prisma = options.prisma ?? defaultPrisma;
  const applyAdjustments = options.applyAdjustments ?? env.FMS_NEGATIVE_ADJUSTMENTS_ENABLED;
  if (options.dryRun) return syncFmsOrderHistory(prisma, client, companyId, { dryRun: true, applyAdjustments });

  if (running) throw new FmsSyncInProgressError();
  running = true;
  const lock = options.lock ?? getDefaultLock();
  let acquired = false;
  try {
    acquired = await lock.tryAcquire();
    if (!acquired) throw new FmsSyncInProgressError();
    const result = await syncFmsOrderHistory(prisma, client, companyId, { applyAdjustments });
    if (syncChangedData(result)) clearSalesDerivedCaches();
    return result;
  } finally {
    if (acquired) await lock.release().catch((err) => logger.error("Failed to release the FMS sync lock", { error: String(err) }));
    running = false;
  }
}

/** FMS_AUTO_SYNC_COMPANY_ID if it exists, otherwise the only company; null when ambiguous or missing. */
export async function resolveAutoSyncCompanyId(
  prisma: Pick<PrismaClient, "company">,
  configured: string | undefined,
): Promise<string | null> {
  if (configured) {
    const company = await prisma.company.findUnique({ where: { id: configured }, select: { id: true } });
    return company?.id ?? null;
  }
  const companies = await prisma.company.findMany({ select: { id: true }, take: 2 });
  return companies.length === 1 ? companies[0].id : null;
}

/** One automatic run: skipped if another is in progress; never throws. */
export async function runAutoSyncOnce(client: FmsClient, companyId: string, options: ExclusiveSyncOptions = {}): Promise<void> {
  try {
    const result = await runFmsHistorySyncExclusive(client, companyId, options);
    const summary = {
      inserted: result.rowsSynced,
      updated: result.rowsUpdated,
      restored: result.rowsRestored,
      renumbered: result.rowsRenumbered,
      cancelled: result.rowsMarkedCancelled,
      superseded: result.rowsSuperseded,
      adjustmentRows: result.rowsAdjustment,
      adjustmentsUnapplied: result.rowsAdjustmentUnapplied,
      unchanged: result.rowsSkippedDuplicate,
      failed: result.rowsFailed,
      missingFromSheet: result.rowsMissingFromSheet,
      durationMs: result.durationMs,
    };
    logger.info("FMS automatic sync finished", summary);
    if (syncChangedData(result)) {
      await logAudit({
        userId: null,
        action: "FMS_ORDER_HISTORY_AUTO_SYNCED",
        entityType: "SalesRecord",
        entityId: null,
        metadata: { ...summary, accountsCreated: result.accountsCreated, changes: result.changes, errors: result.errors },
      });
    }
  } catch (err) {
    if (err instanceof FmsSyncInProgressError) {
      logger.info("FMS automatic sync skipped: another sync is in progress");
      return;
    }
    logger.error("FMS automatic sync failed; will retry next interval", { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Calls `run` after `initialDelayMs`, then `intervalMs` after each run
 * finishes — so runs never pile up. Timers don't keep the process alive.
 */
export function startFmsAutoSync(options: { intervalMs: number; initialDelayMs: number; run: () => Promise<void> }): { stop: () => void } {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await options.run();
      schedule(options.intervalMs);
    }, delay);
    timer.unref();
  };
  schedule(options.initialDelayMs);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** Starts the automatic sync if FMS_AUTO_SYNC_ENABLED and an FMS URL are configured (called from server.ts). */
export async function startConfiguredFmsAutoSync(): Promise<void> {
  if (!env.FMS_AUTO_SYNC_ENABLED) return;
  const client = getFmsClient();
  if (!client) {
    logger.warn("FMS automatic sync is enabled but no FMS URL is configured; not starting");
    return;
  }
  const companyId = await resolveAutoSyncCompanyId(defaultPrisma, env.FMS_AUTO_SYNC_COMPANY_ID);
  if (!companyId) {
    logger.warn("FMS automatic sync is enabled but its company is unknown (set FMS_AUTO_SYNC_COMPANY_ID); not starting");
    return;
  }
  const intervalMs = env.FMS_AUTO_SYNC_INTERVAL_MINUTES * 60_000;
  startFmsAutoSync({ intervalMs, initialDelayMs: 60_000, run: () => runAutoSyncOnce(client, companyId) });
  logger.info("FMS automatic sync started", { intervalMinutes: env.FMS_AUTO_SYNC_INTERVAL_MINUTES });
}
