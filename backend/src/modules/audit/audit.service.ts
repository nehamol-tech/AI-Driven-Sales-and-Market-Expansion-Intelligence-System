import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";

export interface LogAuditInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Writes an AuditLog row. Intentionally swallows failures (logs them
 * instead) so that audit logging can never break the mutating request it's
 * attached to.
 */
export async function logAudit(input: LogAuditInput, client: Pick<PrismaClient, "auditLog"> = defaultPrisma): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata ? (input.metadata as object) : undefined,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (err) {
    logger.error("Failed to write audit log", {
      action: input.action,
      entityType: input.entityType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
