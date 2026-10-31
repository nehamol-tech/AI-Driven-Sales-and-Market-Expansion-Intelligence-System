import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, ConflictError, UnauthorizedError } from "../../lib/errors.js";
import { getCachedFmsClient, getFmsClient } from "./fms-client.factory.js";
import * as fmsService from "./fms.service.js";
import * as fmsOrderSyncService from "./fms-order-sync.service.js";
import { FmsSyncInProgressError, runFmsHistorySyncExclusive } from "./fms-auto-sync.js";
import type { FmsDataQuery } from "./fms.schema.js";
import { logAudit } from "../audit/audit.service.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function getData(req: Request, res: Response): Promise<void> {
  requireUser(req);
  const { sheet, limit } = req.query as unknown as FmsDataQuery;

  // Cached: the Apps Script reads its whole sheet per call (~2–80 s). The sync handlers below stay uncached.
  const client = getCachedFmsClient();
  if (!client) {
    res.status(200).json({
      configured: false,
      message: "FMS integration is not configured on this server. Set FMS_API_URL to enable it.",
    });
    return;
  }

  const result = await fmsService.getFmsData(client, { sheet, limit });

  if (result.status === "bad_request") {
    throw new BadRequestError(`The FMS API rejected this request: ${result.error}`, { allowedSheets: result.allowedSheets });
  }
  if (result.status === "upstream_error") {
    res.status(502).json({ error: { message: "Failed to fetch data from the FMS API", details: result.message } });
    return;
  }

  res.status(200).json(result.dto);
}

/**
 * Manual, ADMIN-gated sync of order-level rows from the "Form responses 2"
 * FMS sheet into SalesRecord (source=FMS_SYNC). See
 * fms-order-sync.service.ts's header comment for exactly what is and is not
 * persisted this phase. `configured:false` (same shape as getData) when
 * FMS_API_URL isn't set — never a fabricated result.
 */
export async function syncOrders(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  const client = getFmsClient();
  if (!client) {
    res.status(200).json({
      configured: false,
      message: "FMS integration is not configured on this server. Set FMS_API_URL to enable it.",
    });
    return;
  }

  const result = await fmsOrderSyncService.syncFmsOrders(prisma, client, user.companyId);

  await logAudit({
    userId: user.id,
    action: "FMS_ORDERS_SYNCED",
    entityType: "SalesRecord",
    entityId: null,
    metadata: {
      rowsFetched: result.rowsFetched,
      rowsSynced: result.rowsSynced,
      rowsSkippedDuplicate: result.rowsSkippedDuplicate,
      rowsFailed: result.rowsFailed,
      accountsCreated: result.accountsCreated,
      accountsResolved: result.accountsResolved,
    },
    ipAddress: req.ip ?? null,
  });

  res.status(200).json({ configured: true, ...result });
}

/**
 * Manual, ADMIN-gated historical import from the larger "FMS Response"
 * sheet (Phase 4) — a separate action from syncOrders/POST /api/fms/sync,
 * which continues to read only "Form responses 2" unchanged. See
 * fms-order-history-sync.service.ts's header comment for the reconciliation
 * logic that prevents this from double-counting the 18 orders already
 * synced from "Form responses 2".
 */
export async function syncOrderHistory(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  const client = getFmsClient();
  if (!client) {
    res.status(200).json({
      configured: false,
      message: "FMS integration is not configured on this server. Set FMS_API_URL to enable it.",
    });
    return;
  }

  // Same one-at-a-time guard as the automatic sync (fms-auto-sync.ts).
  let result;
  try {
    result = await runFmsHistorySyncExclusive(client, user.companyId, { prisma });
  } catch (err) {
    if (err instanceof FmsSyncInProgressError) throw new ConflictError(err.message);
    throw err;
  }

  await logAudit({
    userId: user.id,
    action: "FMS_ORDER_HISTORY_SYNCED",
    entityType: "SalesRecord",
    entityId: null,
    metadata: {
      rowsFetched: result.rowsFetched,
      rowsSynced: result.rowsSynced,
      rowsReconciledToExisting: result.rowsReconciledToExisting,
      rowsSkippedDuplicate: result.rowsSkippedDuplicate,
      rowsFailed: result.rowsFailed,
      rowsUpdated: result.rowsUpdated,
      rowsRestored: result.rowsRestored,
      rowsMarkedCancelled: result.rowsMarkedCancelled,
      rowsAlreadyCancelled: result.rowsAlreadyCancelled,
      rowsCancelledNotImported: result.rowsCancelledNotImported,
      rowsRenumbered: result.rowsRenumbered,
      rowsSuperseded: result.rowsSuperseded,
      rowsMissingFromSheet: result.rowsMissingFromSheet,
      rowsAdjustment: result.rowsAdjustment,
      rowsAdjustmentUnapplied: result.rowsAdjustmentUnapplied,
      changes: result.changes,
      accountsCreated: result.accountsCreated,
      accountsResolved: result.accountsResolved,
    },
    ipAddress: req.ip ?? null,
  });

  res.status(200).json({ configured: true, ...result });
}
