/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { FollowUpDTO, FollowUpDueByFilter, FollowUpStatus, FollowUpSummaryDTO, LeadType, Role } from "@ai-sales/shared";
import { NotFoundError } from "../../lib/errors.js";
import { toFollowUpDTO } from "./follow-ups.dto.js";
import { FOLLOW_UPS_DEFAULT_LIMIT } from "./follow-ups.schema.js";
import type { CreateFollowUpInput, UpdateFollowUpInput } from "./follow-ups.schema.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * MS_PER_DAY;

export const followUpInclude = {
  account: { select: { name: true } },
  prospect: { select: { businessName: true } },
  assignedUser: { select: { name: true } },
} satisfies Prisma.FollowUpInclude;

/**
 * "today" is the server's own UTC calendar day (start-of-day inclusive,
 * next-day-start exclusive). Nothing elsewhere in this codebase carries a
 * per-user timezone (dates are always compared/stored in UTC — see e.g.
 * scoring.service.ts's recencyDays computation), so "the caller's
 * server-local calendar day" here means the server process's own UTC clock,
 * not a browser-supplied offset.
 */
function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Pure date-range predicate for one dueBy bucket, independent of status:
 *  - "overdue": dueDate strictly before `now` (an instant-in-time boundary,
 *    not a calendar-day one — a follow-up due at 23:00 today is overdue at
 *    23:01 today, not only from tomorrow).
 *  - "today": dueDate anywhere within today's UTC calendar day.
 *  - "week": dueDate from `now` (inclusive) through exactly 7*24h later
 *    (exclusive) — a rolling 7-day window from the current instant, not
 *    from midnight. A follow-up due exactly 7 days from now is NOT included
 *    (the upper bound is exclusive); a follow-up due exactly at `now` IS
 *    included (the lower bound is inclusive).
 *  - "all": no date constraint (returns undefined).
 */
function dueByDateRange(dueBy: FollowUpDueByFilter, now: Date): Prisma.DateTimeFilter | undefined {
  if (dueBy === "all") return undefined;
  if (dueBy === "overdue") return { lt: now };
  if (dueBy === "today") {
    const start = startOfUTCDay(now);
    const end = new Date(start.getTime() + MS_PER_DAY);
    return { gte: start, lt: end };
  }
  // "week"
  return { gte: now, lt: new Date(now.getTime() + WEEK_MS) };
}

export interface ListFollowUpsFilters {
  status?: FollowUpStatus;
  dueBy?: FollowUpDueByFilter;
  leadType?: LeadType;
  limit?: number;
  /** Injectable for tests only — defaults to `new Date()`. */
  now?: Date;
}

/**
 * Returns the summary shape: overdueCount/todayCount/weekCount are always
 * computed from the FULL real set for the company — scoped to
 * `status: PENDING` and their own date range only — completely independent
 * of whatever status/dueBy/leadType filter or limit is applied to `items`.
 * This mirrors the "counts independent of the narration cap" pattern
 * established in Phase 3A/3C/4 (e.g. opportunities/sales-agent summaries).
 */
export async function listFollowUps(prisma: PrismaClient, companyId: string, filters: ListFollowUpsFilters): Promise<FollowUpSummaryDTO> {
  const now = filters.now ?? new Date();
  const dueBy = filters.dueBy ?? "all";
  const limit = filters.limit ?? FOLLOW_UPS_DEFAULT_LIMIT;

  const [overdueCount, todayCount, weekCount] = await Promise.all([
    prisma.followUp.count({ where: { companyId, status: "PENDING", dueDate: dueByDateRange("overdue", now) } }),
    prisma.followUp.count({ where: { companyId, status: "PENDING", dueDate: dueByDateRange("today", now) } }),
    prisma.followUp.count({ where: { companyId, status: "PENDING", dueDate: dueByDateRange("week", now) } }),
  ]);

  const dateRange = dueByDateRange(dueBy, now);
  // "overdue" only makes sense for still-pending work, so it implies
  // status: PENDING unless the caller explicitly asked for a different
  // status — an explicit `status` filter always wins over this implicit
  // default (e.g. status=COMPLETED&dueBy=overdue legitimately asks for
  // completed items whose due date happens to be in the past).
  const statusFilter: FollowUpStatus | undefined = filters.status ?? (dueBy === "overdue" ? "PENDING" : undefined);

  const where: Prisma.FollowUpWhereInput = {
    companyId,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(filters.leadType === "accounts" ? { accountId: { not: null } } : {}),
    ...(filters.leadType === "prospects" ? { prospectId: { not: null } } : {}),
    ...(dateRange ? { dueDate: dateRange } : {}),
  };

  const items = await prisma.followUp.findMany({
    where,
    include: followUpInclude,
    orderBy: { dueDate: "asc" },
    take: limit,
  });

  return {
    overdueCount,
    todayCount,
    weekCount,
    items: items.map(toFollowUpDTO),
  };
}

export interface PersistFollowUpParams {
  companyId: string;
  accountId?: string | null;
  prospectId?: string | null;
  dueDate: Date;
  notes?: string | null;
  assignedUserId?: string | null;
  createdById: string | null;
}

/**
 * Low-level create — enforces the accountId/prospectId XOR invariant before
 * any DB call, mirroring scoring.service.ts's persistLeadScore exactly.
 * `createFollowUp` (the public entry point below) always calls this with
 * exactly one of accountId/prospectId set, derived from the already-
 * validated `leadType`, so in normal operation this check can never fire —
 * it exists as defense-in-depth against a future caller bypassing that
 * derivation, exactly like persistLeadScore's own comment explains.
 */
export async function persistFollowUp(prisma: PrismaClient, params: PersistFollowUpParams): Promise<any> {
  const hasAccount = Boolean(params.accountId);
  const hasProspect = Boolean(params.prospectId);
  if (hasAccount === hasProspect) {
    throw new Error("FollowUp requires exactly one of accountId or prospectId to be set (XOR invariant)");
  }

  return prisma.followUp.create({
    data: {
      companyId: params.companyId,
      accountId: params.accountId ?? null,
      prospectId: params.prospectId ?? null,
      dueDate: params.dueDate,
      notes: params.notes ?? null,
      assignedUserId: params.assignedUserId ?? null,
      createdById: params.createdById,
    },
    include: followUpInclude,
  });
}

/**
 * Validates that `leadId`+`leadType` resolves to a real Account/Prospect in
 * this company (404 if not — never creates a dangling reference), then
 * defaults `assignedUserId` to the creator ONLY when it was omitted
 * (`undefined`, not an explicit `null`) AND the creator is a SALES_USER —
 * mirroring sales.controller.ts's createSalesRecord self-attribution
 * pattern exactly. ADMIN/MANAGER omitting it leaves the follow-up
 * unassigned, since they are not necessarily the one doing the follow-up.
 */
export async function createFollowUp(
  prisma: PrismaClient,
  companyId: string,
  creatorUserId: string,
  creatorRole: Role,
  input: CreateFollowUpInput,
): Promise<FollowUpDTO> {
  if (input.leadType === "accounts") {
    const account = await prisma.account.findFirst({ where: { id: input.leadId, companyId } });
    if (!account) throw new NotFoundError("Account not found");
  } else {
    const prospect = await prisma.prospect.findFirst({ where: { id: input.leadId, companyId } });
    if (!prospect) throw new NotFoundError("Prospect not found");
  }

  const assignedUserId =
    input.assignedUserId !== undefined ? input.assignedUserId : creatorRole === "SALES_USER" ? creatorUserId : null;

  const created = await persistFollowUp(prisma, {
    companyId,
    accountId: input.leadType === "accounts" ? input.leadId : null,
    prospectId: input.leadType === "prospects" ? input.leadId : null,
    dueDate: input.dueDate,
    notes: input.notes ?? null,
    assignedUserId,
    createdById: creatorUserId,
  });

  return toFollowUpDTO(created);
}

/**
 * 404s if the follow-up doesn't exist in this company. `completedAt` is
 * always computed server-side here — `UpdateFollowUpInput`'s zod schema has
 * no `completedAt` field at all, so there is structurally nothing in the
 * request body a client could use to override it:
 *  - transitioning TO "COMPLETED" (from any other status) stamps
 *    `completedAt = now`; if it was already COMPLETED, `completedAt` is
 *    left untouched (re-saving other fields on an already-completed
 *    follow-up doesn't reset its completion time).
 *  - transitioning TO "PENDING" clears `completedAt` back to null.
 *  - transitioning TO "CANCELLED" leaves `completedAt` as whatever it
 *    already was (cancelling is not completing).
 */
export async function updateFollowUp(prisma: PrismaClient, companyId: string, id: string, input: UpdateFollowUpInput): Promise<FollowUpDTO> {
  const existing = await prisma.followUp.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Follow-up not found");
  }

  let completedAt = existing.completedAt;
  if (input.status !== undefined) {
    if (input.status === "COMPLETED") {
      completedAt = existing.status === "COMPLETED" ? existing.completedAt : new Date();
    } else if (input.status === "PENDING") {
      completedAt = null;
    }
  }

  const updated = await prisma.followUp.update({
    where: { id },
    data: {
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
      ...(input.status !== undefined ? { status: input.status, completedAt } : {}),
      ...(input.completionNotes !== undefined ? { completionNotes: input.completionNotes } : {}),
    },
    include: followUpInclude,
  });

  return toFollowUpDTO(updated);
}

/**
 * Hard delete — a FollowUp is purely a scheduling/reminder record (nothing
 * downstream derives intelligence from its history the way LeadScore's
 * history or a SalesRecord's audit trail do), so unlike Product (soft-
 * deleted via isActive:false, since historical SalesRecords still reference
 * it) or SalesRecord/Prospect (immutable business data, never truly erased,
 * only ADMIN/MANAGER-gated), a real `delete` is safe and simplest here:
 * there is nothing else in the schema that references a FollowUp by id.
 */
export async function deleteFollowUp(prisma: PrismaClient, companyId: string, id: string): Promise<void> {
  const existing = await prisma.followUp.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Follow-up not found");
  }
  await prisma.followUp.delete({ where: { id } });
}
