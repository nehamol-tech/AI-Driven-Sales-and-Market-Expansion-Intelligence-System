import { describe, it, expect, vi } from "vitest";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";
import { ConflictError } from "../../src/lib/errors.js";
import {
  generateRecommendations,
  approveRecommendation,
  rejectRecommendation,
  type OptimizationPrismaDeps,
} from "../../src/modules/optimization/optimization.service.js";

function makeFakeAIProvider(responses: (string | Error)[]): AIProvider {
  let call = 0;
  return {
    name: "fake",
    async generateCompletion(): Promise<AIProviderCompletion> {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (response instanceof Error) throw response;
      return { content: response, usage: undefined };
    },
  };
}

/* -------------------------------------------------------------------------
 * A fully-stubbed "empty" OptimizationPrismaDeps — every real detector's
 * query returns zero real rows, so generateRecommendations detects zero
 * candidates by default. Individual tests override just the keys relevant
 * to the detector they're exercising.
 * ---------------------------------------------------------------------- */
function makeEmptyDeps(overrides: Record<string, unknown> = {}): OptimizationPrismaDeps {
  const createdRows: any[] = [];
  let idCounter = 0;

  const base = {
    account: { findMany: async () => [], findUnique: async () => null },
    salesRecord: { findMany: async () => [], aggregate: async () => ({ _sum: { orderValue: 0, amount: 0 } }), groupBy: async () => [] },
    leadScore: { findMany: async () => [] },
    product: { findMany: async () => [] },
    adCampaign: { findMany: async () => [] },
    adSpendRecord: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    prospect: { count: async () => 0, findMany: async () => [] },
    state: { findMany: async () => [] },
    distributor: { findMany: async () => [] },
    distributorTerritory: { findMany: async () => [] },
    followUp: { findMany: async () => [] },
    optimizationRecommendation: {
      findMany: async () => [],
      findFirst: async () => null,
      count: async () => 0,
      create: async (args: { data: Record<string, unknown> }) => {
        idCounter += 1;
        const row = { id: `rec_${idCounter}`, createdAt: new Date(), updatedAt: new Date(), reviewedBy: null, ...args.data };
        createdRows.push(row);
        return row;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = createdRows.findIndex((r) => r.id === args.where.id);
        if (idx >= 0) {
          createdRows[idx] = { ...createdRows[idx], ...args.data };
          return createdRows[idx];
        }
        return { id: args.where.id, ...args.data };
      },
    },
  };

  return { ...base, ...overrides } as unknown as OptimizationPrismaDeps;
}

const NOW = new Date("2026-09-07T00:00:00Z");

/* =========================================================================
 * generateRecommendations
 * ========================================================================= */

describe("generateRecommendations", () => {
  it("returns zero candidates and never calls the AI when nothing real qualifies", async () => {
    const deps = makeEmptyDeps();
    const provider = makeFakeAIProvider(["[]"]);
    const spy = vi.spyOn(provider, "generateCompletion");

    const result = await generateRecommendations(deps, provider, "c1", NOW);

    expect(result.created).toEqual([]);
    expect(result.skippedDuplicates).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("detects a real SCHEDULE_FOLLOW_UP candidate for a HOT lead with zero pending follow-ups, and narrates it via a successful AI call", async () => {
    const deps = makeEmptyDeps({
      leadScore: {
        findMany: async () => [{ accountId: "acc_1", prospectId: null, classification: "HOT", account: { id: "acc_1", name: "Acme Retail" }, prospect: null }],
      },
    });
    const provider = makeFakeAIProvider([JSON.stringify([{ id: "rec_1", narrative: "Acme Retail is HOT with no follow-up on file." }])]);

    const result = await generateRecommendations(deps, provider, "c1", NOW);

    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({
      type: "SCHEDULE_FOLLOW_UP",
      targetType: "ACCOUNT",
      targetId: "acc_1",
      targetLabel: "Acme Retail",
      status: "PENDING",
      narrativeMethod: "AI",
      narrative: "Acme Retail is HOT with no follow-up on file.",
    });
  });

  it("falls back to a RULE_BASED narrative referencing the real classification when the AI fails both attempts", async () => {
    const deps = makeEmptyDeps({
      leadScore: {
        findMany: async () => [{ accountId: "acc_1", prospectId: null, classification: "WARM", account: { id: "acc_1", name: "Acme Retail" }, prospect: null }],
      },
    });
    const provider = makeFakeAIProvider(["not json", "still not valid json"]);
    const spy = vi.spyOn(provider, "generateCompletion");

    const result = await generateRecommendations(deps, provider, "c1", NOW);

    expect(spy).toHaveBeenCalledTimes(2); // one retry, never more
    expect(result.created).toHaveLength(1);
    expect(result.created[0].narrativeMethod).toBe("RULE_BASED");
    expect(result.created[0].narrative).toContain("WARM");
  });

  it("excludes a HOT/WARM lead that already has a pending follow-up (detector-level filtering)", async () => {
    const deps = makeEmptyDeps({
      leadScore: {
        findMany: async () => [{ accountId: "acc_1", prospectId: null, classification: "HOT", account: { id: "acc_1", name: "Acme Retail" }, prospect: null }],
      },
      followUp: { findMany: async () => [{ accountId: "acc_1", prospectId: null }] },
    });
    const provider = makeFakeAIProvider(["[]"]);
    const spy = vi.spyOn(provider, "generateCompletion");

    const result = await generateRecommendations(deps, provider, "c1", NOW);

    expect(result.created).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("detects a real AT_RISK_FOLLOW_UP candidate via detectAtRisk (Phase 3C, reused directly) and includes the real decline% in evidence", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
    const deps = makeEmptyDeps({
      account: { findMany: async () => [{ id: "acc_1", name: "Acme Retail", industryId: null, stateId: null, industry: null }], findUnique: async () => null },
      salesRecord: {
        findMany: async () => [
          { accountId: "acc_1", date: daysAgo(108), orderValue: "2000", productId: null },
          { accountId: "acc_1", date: daysAgo(77), orderValue: "3000", productId: null }, // prior window: 5000
          { accountId: "acc_1", date: daysAgo(16), orderValue: "500", productId: null }, // recent window: 500 -> 90% decline
        ],
        aggregate: async () => ({ _sum: { orderValue: 0, amount: 0 } }),
        groupBy: async () => [],
      },
    });
    const provider = makeFakeAIProvider(["not json", "not json"]); // force RULE_BASED so we can assert on the real evidence-derived text

    const result = await generateRecommendations(deps, provider, "c1", NOW);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].type).toBe("AT_RISK_FOLLOW_UP");
    expect(result.created[0].targetId).toBe("acc_1");
    expect(result.created[0].evidence.declinePct).toBe(90);
    expect(result.created[0].narrative).toContain("90%");
  });

  it("dedups a new candidate against an existing PENDING row of the same (type, targetType, targetId) — skips it and never persists or calls the AI for it", async () => {
    const create = vi.fn();
    const update = vi.fn();
    const deps = makeEmptyDeps({
      leadScore: {
        findMany: async () => [{ accountId: "acc_1", prospectId: null, classification: "HOT", account: { id: "acc_1", name: "Acme Retail" }, prospect: null }],
      },
      optimizationRecommendation: {
        findMany: async () => [{ type: "SCHEDULE_FOLLOW_UP", targetType: "ACCOUNT", targetId: "acc_1" }],
        findFirst: async () => null,
        count: async () => 0,
        create,
        update,
      },
    });
    const provider = makeFakeAIProvider(["[]"]);
    const spy = vi.spyOn(provider, "generateCompletion");

    const result = await generateRecommendations(deps, provider, "c1", NOW);

    expect(result.created).toEqual([]);
    expect(result.skippedDuplicates).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});

/* =========================================================================
 * approveRecommendation — real integration with createFollowUp/updateCampaign
 * ========================================================================= */

function makeFakePrisma(overrides: Record<string, any> = {}) {
  const base: Record<string, any> = {
    optimizationRecommendation: { findFirst: vi.fn(), update: vi.fn() },
    followUp: {
      count: vi.fn(async () => 0),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "fu_new",
        accountId: args.data.accountId ?? null,
        prospectId: args.data.prospectId ?? null,
        dueDate: args.data.dueDate,
        notes: args.data.notes ?? null,
        status: "PENDING",
        completedAt: null,
        completionNotes: null,
        assignedUserId: args.data.assignedUserId ?? null,
        createdAt: new Date(),
        account: { name: "Acme Retail" },
        prospect: null,
        assignedUser: null,
      })),
    },
    account: { findFirst: vi.fn(async () => ({ id: "acc_1" })) },
    prospect: { findFirst: vi.fn(async () => null), count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    adCampaign: { findFirst: vi.fn(), update: vi.fn() },
    adSpendRecord: { aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) },
    salesRecord: { aggregate: vi.fn(async () => ({ _sum: { orderValue: 0 } })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { ...base, ...overrides };
}

function makePendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec_1",
    companyId: "c1",
    status: "PENDING",
    type: "SCHEDULE_FOLLOW_UP",
    targetType: "ACCOUNT",
    targetId: "acc_1",
    targetLabel: "Acme Retail",
    actionType: "CREATE_FOLLOW_UP",
    actionParams: { leadId: "acc_1", leadType: "accounts", dueDate: "2026-09-10T00:00:00.000Z", notes: null },
    evidence: { classification: "HOT" },
    narrative: "Acme Retail is HOT with no follow-up on file.",
    narrativeMethod: "AI",
    reviewedByUserId: null,
    reviewedAt: null,
    executedAt: null,
    executionResult: null,
    createdAt: new Date("2026-09-07T00:00:00Z"),
    updatedAt: new Date("2026-09-07T00:00:00Z"),
    ...overrides,
  };
}

describe("approveRecommendation", () => {
  it("happy path: executes the real createFollowUp and results in EXECUTED with a real createdEntityId", async () => {
    const existing = makePendingRow();
    const prisma = makeFakePrisma({
      optimizationRecommendation: {
        findFirst: vi.fn(async () => existing),
        update: vi.fn(async (args: any) => ({ ...existing, ...args.data, reviewedBy: null })),
      },
    });

    const result = await approveRecommendation(prisma as never, "c1", "rec_1", "admin1", "ADMIN", new Date("2026-09-08T00:00:00Z"));

    expect(result.status).toBe("EXECUTED");
    expect(result.executionResult?.success).toBe(true);
    expect(result.executionResult?.createdEntityId).toBe("fu_new");
    expect(prisma.followUp.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("stale case: a pending follow-up already exists at approval time -> EXECUTION_FAILED WITHOUT ever calling createFollowUp's mutation", async () => {
    const existing = makePendingRow();
    const prisma = makeFakePrisma({
      followUp: { count: vi.fn(async () => 1), create: vi.fn() }, // now stale: a pending follow-up exists
      optimizationRecommendation: {
        findFirst: vi.fn(async () => existing),
        update: vi.fn(async (args: any) => ({ ...existing, ...args.data, reviewedBy: null })),
      },
    });

    const result = await approveRecommendation(prisma as never, "c1", "rec_1", "admin1", "ADMIN", new Date("2026-09-08T00:00:00Z"));

    expect(result.status).toBe("EXECUTION_FAILED");
    expect(result.executionResult?.success).toBe(false);
    expect(result.executionResult?.message).toMatch(/already has a pending follow-up/i);
    expect(prisma.followUp.create).not.toHaveBeenCalled();
    expect(prisma.account.findFirst).not.toHaveBeenCalled(); // createFollowUp itself was never invoked
  });

  it("a thrown execution error (real 404 from createFollowUp) is captured verbatim in executionResult, not swallowed", async () => {
    const existing = makePendingRow();
    const prisma = makeFakePrisma({
      account: { findFirst: vi.fn(async () => null) }, // the account no longer exists -> createFollowUp throws NotFoundError("Account not found")
      optimizationRecommendation: {
        findFirst: vi.fn(async () => existing),
        update: vi.fn(async (args: any) => ({ ...existing, ...args.data, reviewedBy: null })),
      },
    });

    const result = await approveRecommendation(prisma as never, "c1", "rec_1", "admin1", "ADMIN", new Date("2026-09-08T00:00:00Z"));

    expect(result.status).toBe("EXECUTION_FAILED");
    expect(result.executionResult?.success).toBe(false);
    expect(result.executionResult?.message).toBe("Account not found");
  });

  it("rejects approving an already-EXECUTED row with a 409-equivalent ConflictError", async () => {
    const existing = makePendingRow({ status: "EXECUTED" });
    const prisma = makeFakePrisma({ optimizationRecommendation: { findFirst: vi.fn(async () => existing), update: vi.fn() } });

    await expect(approveRecommendation(prisma as never, "c1", "rec_1", "admin1", "ADMIN")).rejects.toBeInstanceOf(ConflictError);
  });

  it("PAUSE_CAMPAIGN happy path: re-validates ROAS is still underperforming, then really pauses the campaign via updateCampaign", async () => {
    const existing = makePendingRow({
      type: "PAUSE_UNDERPERFORMING_CAMPAIGN",
      actionType: "PAUSE_CAMPAIGN",
      actionParams: { campaignId: "camp_1" },
      evidence: { roas: 0.5 },
    });
    const campaignRow = {
      id: "camp_1",
      companyId: "c1",
      name: "Summer Push",
      platform: "META",
      source: "MANUAL",
      externalCampaignId: null,
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: null,
      isActive: true,
      createdById: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const prisma = makeFakePrisma({
      optimizationRecommendation: {
        findFirst: vi.fn(async () => existing),
        update: vi.fn(async (args: any) => ({ ...existing, ...args.data, reviewedBy: null })),
      },
      adCampaign: {
        findFirst: vi.fn(async () => campaignRow),
        update: vi.fn(async (args: any) => ({ ...campaignRow, ...args.data })),
      },
      adSpendRecord: { aggregate: vi.fn(async () => ({ _sum: { amount: 1000 } })) },
      prospect: {
        findFirst: vi.fn(async () => null),
        count: vi.fn(async (args: any) => (args.where?.status === "WON" ? 1 : 5)),
        findMany: vi.fn(async () => [{ businessName: "Acme Retail" }]),
      },
      account: { findFirst: vi.fn(async () => ({ id: "acc_1" })), findUnique: vi.fn(async () => ({ id: "acc_x" })) },
      salesRecord: { aggregate: vi.fn(async () => ({ _sum: { orderValue: 500 } })) }, // roas = 500/1000 = 0.5, still < 1
    });

    const result = await approveRecommendation(prisma as never, "c1", "rec_1", "admin1", "ADMIN");

    expect(result.status).toBe("EXECUTED");
    expect(result.executionResult?.success).toBe(true);
    expect(prisma.adCampaign.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  it("PAUSE_CAMPAIGN stale case: ROAS is no longer underperforming at approval time -> EXECUTION_FAILED, campaign never updated", async () => {
    const existing = makePendingRow({
      type: "PAUSE_UNDERPERFORMING_CAMPAIGN",
      actionType: "PAUSE_CAMPAIGN",
      actionParams: { campaignId: "camp_1" },
      evidence: { roas: 0.5 },
    });
    const campaignRow = {
      id: "camp_1",
      companyId: "c1",
      name: "Summer Push",
      platform: "META",
      source: "MANUAL",
      externalCampaignId: null,
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: null,
      isActive: true,
      createdById: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const prisma = makeFakePrisma({
      optimizationRecommendation: {
        findFirst: vi.fn(async () => existing),
        update: vi.fn(async (args: any) => ({ ...existing, ...args.data, reviewedBy: null })),
      },
      adCampaign: { findFirst: vi.fn(async () => campaignRow), update: vi.fn() },
      adSpendRecord: { aggregate: vi.fn(async () => ({ _sum: { amount: 1000 } })) },
      prospect: {
        findFirst: vi.fn(async () => null),
        count: vi.fn(async (args: any) => (args.where?.status === "WON" ? 1 : 5)),
        findMany: vi.fn(async () => [{ businessName: "Acme Retail" }]),
      },
      account: { findFirst: vi.fn(async () => ({ id: "acc_1" })), findUnique: vi.fn(async () => ({ id: "acc_x" })) },
      salesRecord: { aggregate: vi.fn(async () => ({ _sum: { orderValue: 5000 } })) }, // roas = 5000/1000 = 5.0, no longer underperforming
    });

    const result = await approveRecommendation(prisma as never, "c1", "rec_1", "admin1", "ADMIN");

    expect(result.status).toBe("EXECUTION_FAILED");
    expect(result.executionResult?.message).toMatch(/no longer underperforming/i);
    expect(prisma.adCampaign.update).not.toHaveBeenCalled();
  });
});

/* =========================================================================
 * rejectRecommendation
 * ========================================================================= */

describe("rejectRecommendation", () => {
  it("happy path: rejects a PENDING row without executing anything", async () => {
    const existing = makePendingRow();
    const prisma = makeFakePrisma({
      optimizationRecommendation: {
        findFirst: vi.fn(async () => existing),
        update: vi.fn(async (args: any) => ({ ...existing, ...args.data, reviewedBy: null })),
      },
    });

    const result = await rejectRecommendation(prisma as never, "c1", "rec_1", "admin1", new Date("2026-09-08T00:00:00Z"));

    expect(result.status).toBe("REJECTED");
    expect(prisma.followUp.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rejects rejecting an already-REJECTED row with a 409-equivalent ConflictError", async () => {
    const existing = makePendingRow({ status: "REJECTED" });
    const prisma = makeFakePrisma({ optimizationRecommendation: { findFirst: vi.fn(async () => existing), update: vi.fn() } });

    await expect(rejectRecommendation(prisma as never, "c1", "rec_1", "admin1")).rejects.toBeInstanceOf(ConflictError);
  });
});
