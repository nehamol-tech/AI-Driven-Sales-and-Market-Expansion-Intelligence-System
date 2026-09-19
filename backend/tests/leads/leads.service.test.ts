import { describe, it, expect, vi } from "vitest";
import { getLeadSummary } from "../../src/modules/leads/leads.service.js";

interface FakeArgs {
  where?: Record<string, unknown>;
}

function makeFakePrisma(opts: {
  accountCount: number;
  prospectCount: number;
  hotCount: number;
  warmCount: number;
  coldCount: number;
  unscoredAccounts: number;
  unscoredProspects: number;
  topHot: { score: number; classification: string; accountId: string | null; prospectId: string | null; account: { name: string } | null; prospect: { businessName: string } | null }[];
}) {
  return {
    account: {
      count: vi.fn(async (args: FakeArgs) => (args?.where?.scores ? opts.unscoredAccounts : opts.accountCount)),
    },
    prospect: {
      count: vi.fn(async (args: FakeArgs) => (args?.where?.scores ? opts.unscoredProspects : opts.prospectCount)),
    },
    leadScore: {
      count: vi.fn(async (args: FakeArgs) => {
        const classification = (args?.where as { classification?: string })?.classification;
        if (classification === "HOT") return opts.hotCount;
        if (classification === "WARM") return opts.warmCount;
        if (classification === "COLD") return opts.coldCount;
        return 0;
      }),
      findMany: vi.fn(async () => opts.topHot),
    },
  };
}

describe("getLeadSummary", () => {
  it("returns insufficient_data for every metric when there are no accounts or prospects at all", async () => {
    const prisma = makeFakePrisma({
      accountCount: 0,
      prospectCount: 0,
      hotCount: 0,
      warmCount: 0,
      coldCount: 0,
      unscoredAccounts: 0,
      unscoredProspects: 0,
      topHot: [],
    });
    const summary = await getLeadSummary(prisma as never, "c1");
    expect(summary.hotCount).toEqual({ status: "insufficient_data" });
    expect(summary.warmCount).toEqual({ status: "insufficient_data" });
    expect(summary.coldCount).toEqual({ status: "insufficient_data" });
    expect(summary.unscoredCount).toEqual({ status: "insufficient_data" });
    expect(summary.topHotLeads).toEqual({ status: "insufficient_data" });
  });

  it("returns real computed counts once at least one account or prospect exists", async () => {
    const prisma = makeFakePrisma({
      accountCount: 2,
      prospectCount: 1,
      hotCount: 1,
      warmCount: 1,
      coldCount: 0,
      unscoredAccounts: 1,
      unscoredProspects: 0,
      topHot: [{ score: 88, classification: "HOT", accountId: "a1", prospectId: null, account: { name: "Acme" }, prospect: null }],
    });
    const summary = await getLeadSummary(prisma as never, "c1");
    expect(summary.hotCount).toEqual({ status: "ok", value: 1 });
    expect(summary.warmCount).toEqual({ status: "ok", value: 1 });
    expect(summary.coldCount).toEqual({ status: "ok", value: 0 });
    expect(summary.unscoredCount).toEqual({ status: "ok", value: 1 });
    expect(summary.topHotLeads).toEqual({
      status: "ok",
      value: [{ leadType: "accounts", id: "a1", name: "Acme", classification: "HOT", score: 88 }],
    });
  });

  it("returns insufficient_data for topHotLeads when there are leads but none are HOT", async () => {
    const prisma = makeFakePrisma({
      accountCount: 1,
      prospectCount: 0,
      hotCount: 0,
      warmCount: 1,
      coldCount: 0,
      unscoredAccounts: 0,
      unscoredProspects: 0,
      topHot: [],
    });
    const summary = await getLeadSummary(prisma as never, "c1");
    expect(summary.topHotLeads).toEqual({ status: "insufficient_data" });
  });
});
