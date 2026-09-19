import { describe, it, expect, vi } from "vitest";
import { NotFoundError } from "../../src/lib/errors.js";
import {
  listFollowUps,
  createFollowUp,
  persistFollowUp,
  updateFollowUp,
  deleteFollowUp,
} from "../../src/modules/follow-ups/follow-ups.service.js";

function makeFollowUpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "fu1",
    companyId: "c1",
    accountId: "a1",
    prospectId: null,
    dueDate: new Date("2026-08-20T00:00:00Z"),
    notes: null,
    status: "PENDING",
    completedAt: null,
    completionNotes: null,
    assignedUserId: null,
    createdById: "u1",
    createdAt: new Date("2026-08-18T00:00:00Z"),
    updatedAt: new Date("2026-08-18T00:00:00Z"),
    account: { name: "Acme Corp" },
    prospect: null,
    assignedUser: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * persistFollowUp — accountId/prospectId XOR invariant (test #1)
 * ---------------------------------------------------------------------- */

describe("persistFollowUp XOR invariant", () => {
  const baseParams = { companyId: "c1", dueDate: new Date("2026-08-20T00:00:00Z"), createdById: "u1" };

  it("throws when neither accountId nor prospectId is set", async () => {
    await expect(persistFollowUp({} as never, { ...baseParams })).rejects.toThrow(/XOR/);
  });

  it("throws when both accountId and prospectId are set", async () => {
    await expect(persistFollowUp({} as never, { ...baseParams, accountId: "a1", prospectId: "p1" })).rejects.toThrow(/XOR/);
  });

  it("does not throw the XOR error when exactly accountId is set (proceeds to use prisma)", async () => {
    const create = vi.fn(async (args: unknown) => ({ ...makeFollowUpRow(), _args: args }));
    const fakePrisma = { followUp: { create } };
    await expect(persistFollowUp(fakePrisma as never, { ...baseParams, accountId: "a1" })).resolves.toBeDefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not throw the XOR error when exactly prospectId is set", async () => {
    const create = vi.fn(async () => makeFollowUpRow({ accountId: null, prospectId: "p1", account: null, prospect: { businessName: "Beta" } }));
    const fakePrisma = { followUp: { create } };
    await expect(persistFollowUp(fakePrisma as never, { ...baseParams, prospectId: "p1" })).resolves.toBeDefined();
  });
});

/* -------------------------------------------------------------------------
 * createFollowUp — 404 when the lead doesn't resolve (test #2), and
 * assignedUserId self-attribution defaulting (test #3)
 * ---------------------------------------------------------------------- */

describe("createFollowUp", () => {
  function makeFakePrisma(opts: { account?: unknown; prospect?: unknown; created?: unknown } = {}) {
    const create = vi.fn(async () => opts.created ?? makeFollowUpRow());
    return {
      account: { findFirst: vi.fn(async () => opts.account ?? null) },
      prospect: { findFirst: vi.fn(async () => opts.prospect ?? null) },
      followUp: { create },
    };
  }

  it("404s when leadType=accounts references an Account that doesn't exist in this company", async () => {
    const prisma = makeFakePrisma({ account: null });
    await expect(
      createFollowUp(prisma as never, "c1", "u1", "SALES_USER", {
        leadId: "missing",
        leadType: "accounts",
        dueDate: new Date("2026-08-20T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404s when leadType=prospects references a Prospect that doesn't exist in this company", async () => {
    const prisma = makeFakePrisma({ prospect: null });
    await expect(
      createFollowUp(prisma as never, "c1", "u1", "SALES_USER", {
        leadId: "missing",
        leadType: "prospects",
        dueDate: new Date("2026-08-20T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not create a dangling FollowUp when the lead 404s (create is never called)", async () => {
    const prisma = makeFakePrisma({ account: null });
    await expect(
      createFollowUp(prisma as never, "c1", "u1", "SALES_USER", {
        leadId: "missing",
        leadType: "accounts",
        dueDate: new Date("2026-08-20T00:00:00Z"),
      }),
    ).rejects.toThrow();
    expect(prisma.followUp.create).not.toHaveBeenCalled();
  });

  it("SALES_USER creating without assignedUserId gets self-assigned", async () => {
    const prisma = makeFakePrisma({ account: { id: "a1" } });
    await createFollowUp(prisma as never, "c1", "u1", "SALES_USER", {
      leadId: "a1",
      leadType: "accounts",
      dueDate: new Date("2026-08-20T00:00:00Z"),
    });
    expect(prisma.followUp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedUserId: "u1" }) }),
    );
  });

  it("ADMIN creating without assignedUserId stays unassigned (null)", async () => {
    const prisma = makeFakePrisma({ account: { id: "a1" } });
    await createFollowUp(prisma as never, "c1", "admin1", "ADMIN", {
      leadId: "a1",
      leadType: "accounts",
      dueDate: new Date("2026-08-20T00:00:00Z"),
    });
    expect(prisma.followUp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedUserId: null }) }),
    );
  });

  it("MANAGER creating without assignedUserId stays unassigned (null)", async () => {
    const prisma = makeFakePrisma({ account: { id: "a1" } });
    await createFollowUp(prisma as never, "c1", "mgr1", "MANAGER", {
      leadId: "a1",
      leadType: "accounts",
      dueDate: new Date("2026-08-20T00:00:00Z"),
    });
    expect(prisma.followUp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedUserId: null }) }),
    );
  });

  it("respects an explicitly given assignedUserId even for SALES_USER (not overridden by self-assignment)", async () => {
    const prisma = makeFakePrisma({ account: { id: "a1" } });
    await createFollowUp(prisma as never, "c1", "u1", "SALES_USER", {
      leadId: "a1",
      leadType: "accounts",
      dueDate: new Date("2026-08-20T00:00:00Z"),
      assignedUserId: "someone-else",
    });
    expect(prisma.followUp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedUserId: "someone-else" }) }),
    );
  });

  it("respects an explicit null assignedUserId (does not self-assign a SALES_USER who explicitly unassigned)", async () => {
    const prisma = makeFakePrisma({ account: { id: "a1" } });
    await createFollowUp(prisma as never, "c1", "u1", "SALES_USER", {
      leadId: "a1",
      leadType: "accounts",
      dueDate: new Date("2026-08-20T00:00:00Z"),
      assignedUserId: null,
    });
    expect(prisma.followUp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedUserId: null }) }),
    );
  });
});

/* -------------------------------------------------------------------------
 * updateFollowUp — server-side completedAt handling (test #6)
 * ---------------------------------------------------------------------- */

describe("updateFollowUp", () => {
  function makeFakePrisma(existing: unknown, updated?: unknown) {
    const update = vi.fn(async () => updated ?? makeFollowUpRow({ status: "COMPLETED" }));
    return {
      followUp: {
        findFirst: vi.fn(async () => existing),
        update,
      },
    };
  }

  it("404s when the follow-up doesn't exist in this company", async () => {
    const prisma = makeFakePrisma(null);
    await expect(updateFollowUp(prisma as never, "c1", "missing", { status: "COMPLETED" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stamps completedAt server-side when transitioning to COMPLETED", async () => {
    const prisma = makeFakePrisma(makeFollowUpRow({ status: "PENDING", completedAt: null }));
    await updateFollowUp(prisma as never, "c1", "fu1", { status: "COMPLETED" });
    const callArgs = prisma.followUp.update.mock.calls[0][0] as { data: { completedAt: Date } };
    expect(callArgs.data.completedAt).toBeInstanceOf(Date);
  });

  it("ignores a client-supplied completedAt — UpdateFollowUpInput's zod schema has no such field, so nothing in the raw input can reach the service's `completedAt` computation at all", async () => {
    const prisma = makeFakePrisma(makeFollowUpRow({ status: "PENDING", completedAt: null }));
    // Simulate a request body that (pre-zod) tried to smuggle a completedAt — the TS type doesn't
    // even allow this field, so a caller can only do so by bypassing the type system, exactly like an
    // attacker bypassing client-side validation; the service ignores it (`input` as typed has no such key).
    const maliciousInput = { status: "COMPLETED", completedAt: "2000-01-01T00:00:00Z" } as unknown as { status: "COMPLETED" };
    await updateFollowUp(prisma as never, "c1", "fu1", maliciousInput);
    const callArgs = prisma.followUp.update.mock.calls[0][0] as { data: { completedAt: Date } };
    expect(callArgs.data.completedAt.toISOString()).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("leaves completedAt untouched when re-saving an already-COMPLETED follow-up (status stays COMPLETED)", async () => {
    const originalCompletedAt = new Date("2026-08-15T00:00:00Z");
    const prisma = makeFakePrisma(makeFollowUpRow({ status: "COMPLETED", completedAt: originalCompletedAt }));
    await updateFollowUp(prisma as never, "c1", "fu1", { status: "COMPLETED", notes: "still true" });
    const callArgs = prisma.followUp.update.mock.calls[0][0] as { data: { completedAt: Date } };
    expect(callArgs.data.completedAt).toBe(originalCompletedAt);
  });

  it("clears completedAt when transitioning back to PENDING", async () => {
    const prisma = makeFakePrisma(makeFollowUpRow({ status: "COMPLETED", completedAt: new Date("2026-08-15T00:00:00Z") }));
    await updateFollowUp(prisma as never, "c1", "fu1", { status: "PENDING" });
    const callArgs = prisma.followUp.update.mock.calls[0][0] as { data: { completedAt: Date | null } };
    expect(callArgs.data.completedAt).toBeNull();
  });

  it("leaves completedAt untouched when transitioning to CANCELLED (cancelling is not completing)", async () => {
    const prisma = makeFakePrisma(makeFollowUpRow({ status: "PENDING", completedAt: null }));
    await updateFollowUp(prisma as never, "c1", "fu1", { status: "CANCELLED" });
    const callArgs = prisma.followUp.update.mock.calls[0][0] as { data: { completedAt: Date | null } };
    expect(callArgs.data.completedAt).toBeNull();
  });

  it("does not touch completedAt at all when status is not part of the update", async () => {
    const prisma = makeFakePrisma(makeFollowUpRow({ status: "PENDING", completedAt: null }));
    await updateFollowUp(prisma as never, "c1", "fu1", { notes: "just a note update" });
    const callArgs = prisma.followUp.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data).not.toHaveProperty("completedAt");
  });
});

/* -------------------------------------------------------------------------
 * deleteFollowUp — 404 + real hard delete
 * ---------------------------------------------------------------------- */

describe("deleteFollowUp", () => {
  it("404s when the follow-up doesn't exist in this company", async () => {
    const prisma = { followUp: { findFirst: vi.fn(async () => null), delete: vi.fn() } };
    await expect(deleteFollowUp(prisma as never, "c1", "missing")).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.followUp.delete).not.toHaveBeenCalled();
  });

  it("hard-deletes when it exists", async () => {
    const del = vi.fn(async () => makeFollowUpRow());
    const prisma = { followUp: { findFirst: vi.fn(async () => makeFollowUpRow()), delete: del } };
    await deleteFollowUp(prisma as never, "c1", "fu1");
    expect(del).toHaveBeenCalledWith({ where: { id: "fu1" } });
  });
});

/* -------------------------------------------------------------------------
 * listFollowUps — dueBy boundary semantics (test #4) and counts computed
 * from the full set, independent of items' own filter/limit (test #5)
 * ---------------------------------------------------------------------- */

describe("listFollowUps — dueBy boundaries", () => {
  const NOW = new Date("2026-08-18T12:00:00Z"); // Tuesday, midday UTC

  function makeFakePrisma(overrides: { count?: number; items?: unknown[] } = {}) {
    const count = vi.fn(async () => overrides.count ?? 0);
    const findMany = vi.fn(async () => overrides.items ?? []);
    return { followUp: { count, findMany } };
  }

  it("computes 'today' as the full UTC calendar day: passes gte=start-of-today-UTC, lt=start-of-tomorrow-UTC to the todayCount query", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW });
    const todayCall = prisma.followUp.count.mock.calls[1][0] as { where: { dueDate: { gte: Date; lt: Date } } };
    expect(todayCall.where.dueDate.gte.toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(todayCall.where.dueDate.lt.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("computes 'overdue' as dueDate < now (an instant boundary, not a calendar-day one)", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW });
    const overdueCall = prisma.followUp.count.mock.calls[0][0] as { where: { status: string; dueDate: { lt: Date } } };
    expect(overdueCall.where.status).toBe("PENDING");
    expect(overdueCall.where.dueDate.lt.toISOString()).toBe(NOW.toISOString());
  });

  it("computes 'week' as [now, now+7days) — a rolling window from the current instant, not from midnight", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW });
    const weekCall = prisma.followUp.count.mock.calls[2][0] as { where: { dueDate: { gte: Date; lt: Date } } };
    expect(weekCall.where.dueDate.gte.toISOString()).toBe(NOW.toISOString());
    expect(weekCall.where.dueDate.lt.toISOString()).toBe("2026-08-25T12:00:00.000Z"); // exactly +7*24h
  });

  it("all three summary counts are scoped to status: PENDING", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW });
    for (const call of prisma.followUp.count.mock.calls) {
      expect((call[0] as { where: { status: string } }).where.status).toBe("PENDING");
    }
  });

  it("dueBy=all applies no date constraint to items", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW, dueBy: "all" });
    const findManyCall = prisma.followUp.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(findManyCall.where).not.toHaveProperty("dueDate");
  });

  it("dueBy=overdue implicitly restricts items to status: PENDING when no explicit status filter is given", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW, dueBy: "overdue" });
    const findManyCall = prisma.followUp.findMany.mock.calls[0][0] as { where: { status?: string } };
    expect(findManyCall.where.status).toBe("PENDING");
  });

  it("an explicit status filter overrides dueBy=overdue's implicit PENDING default", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW, dueBy: "overdue", status: "COMPLETED" });
    const findManyCall = prisma.followUp.findMany.mock.calls[0][0] as { where: { status?: string } };
    expect(findManyCall.where.status).toBe("COMPLETED");
  });

  it("summary counts are computed from the full company set, independent of items' own status/dueBy/leadType filter", async () => {
    const prisma = makeFakePrisma({ count: 7, items: [] });
    const result = await listFollowUps(prisma as never, "c1", {
      now: NOW,
      dueBy: "overdue",
      status: "COMPLETED",
      leadType: "prospects",
      limit: 1,
    });
    // Every count() call must be scoped only by companyId/status:PENDING/date-range — never by the
    // caller's leadType or the caller's own `status` query filter (COMPLETED).
    for (const call of prisma.followUp.count.mock.calls) {
      const where = (call[0] as { where: Record<string, unknown> }).where;
      expect(where).not.toHaveProperty("leadType");
      expect(where).not.toHaveProperty("accountId");
      expect(where).not.toHaveProperty("prospectId");
      expect(where.status).toBe("PENDING"); // never COMPLETED, even though the caller filtered items by COMPLETED
    }
    expect(result.overdueCount).toBe(7);
    expect(result.todayCount).toBe(7);
    expect(result.weekCount).toBe(7);
  });

  it("items' own limit is passed through to findMany's take, independent of the summary counts", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW, limit: 5 });
    const findManyCall = prisma.followUp.findMany.mock.calls[0][0] as { take: number };
    expect(findManyCall.take).toBe(5);
  });

  it("leadType=accounts filters items to accountId not null", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW, leadType: "accounts" });
    const findManyCall = prisma.followUp.findMany.mock.calls[0][0] as { where: { accountId?: unknown } };
    expect(findManyCall.where.accountId).toEqual({ not: null });
  });

  it("leadType=prospects filters items to prospectId not null", async () => {
    const prisma = makeFakePrisma();
    await listFollowUps(prisma as never, "c1", { now: NOW, leadType: "prospects" });
    const findManyCall = prisma.followUp.findMany.mock.calls[0][0] as { where: { prospectId?: unknown } };
    expect(findManyCall.where.prospectId).toEqual({ not: null });
  });
});
