import { describe, it, expect, vi } from "vitest";
import { NotFoundError } from "../../src/lib/errors.js";
import { submitLeadFeedback } from "../../src/modules/leads/feedback.service.js";

function makeFakePrisma(overrides: { leadScoreFindFirst?: unknown; created?: unknown } = {}) {
  const create = vi.fn(async () => overrides.created ?? { id: "fb1", leadScoreId: "score1", userId: "u1", rating: "ACCURATE", comment: null, createdAt: new Date(), user: { name: "Jane" } });
  return {
    prisma: {
      leadScore: { findFirst: vi.fn(async () => overrides.leadScoreFindFirst ?? null) },
      leadScoreFeedback: { create },
    },
    create,
  };
}

describe("submitLeadFeedback", () => {
  it("throws NotFoundError when the lead has no score yet", async () => {
    const { prisma } = makeFakePrisma({ leadScoreFindFirst: null });
    await expect(
      submitLeadFeedback(prisma as never, "c1", "accounts", "a1", "u1", { rating: "ACCURATE", comment: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("attaches feedback to the current latest LeadScore row for an account", async () => {
    const { prisma, create } = makeFakePrisma({ leadScoreFindFirst: { id: "score_latest" } });
    const result = await submitLeadFeedback(prisma as never, "c1", "accounts", "a1", "u1", { rating: "TOO_HIGH", comment: "seems inflated" });

    expect(prisma.leadScore.findFirst).toHaveBeenCalledWith({
      where: { companyId: "c1", isLatest: true, accountId: "a1" },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadScoreId: "score_latest", userId: "u1", rating: "TOO_HIGH", comment: "seems inflated" }),
      }),
    );
    expect(result.rating).toBe("ACCURATE"); // from the fake create's default return value
  });

  it("resolves the latest score by prospectId (not accountId) for a prospect lead", async () => {
    const { prisma } = makeFakePrisma({ leadScoreFindFirst: { id: "score_latest" } });
    await submitLeadFeedback(prisma as never, "c1", "prospects", "p1", "u1", { rating: "TOO_LOW", comment: null });
    expect(prisma.leadScore.findFirst).toHaveBeenCalledWith({
      where: { companyId: "c1", isLatest: true, prospectId: "p1" },
    });
  });
});
