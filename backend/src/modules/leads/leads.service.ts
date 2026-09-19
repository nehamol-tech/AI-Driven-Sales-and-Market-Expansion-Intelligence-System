import type { PrismaClient } from "@prisma/client";
import type { LeadBoardEntryDTO, LeadScoreResult, LeadSummaryDTO, LeadType, MetricValue } from "@ai-sales/shared";
import { triggerAccountScore } from "./accounts.service.js";
import { triggerProspectScore } from "./prospects.service.js";

function ok<T>(value: T): MetricValue<T> {
  return { status: "ok", value };
}
const insufficientData: MetricValue<never> = { status: "insufficient_data" };

/**
 * Board-level summary: counts by classification + how many leads have no
 * score yet. Mirrors the dashboard's MetricValue pattern — if the company
 * has no accounts or prospects at all, every metric is insufficient_data
 * rather than a fabricated zero.
 */
export async function getLeadSummary(prisma: PrismaClient, companyId: string): Promise<LeadSummaryDTO> {
  const [accountCount, prospectCount] = await Promise.all([
    prisma.account.count({ where: { companyId } }),
    prisma.prospect.count({ where: { companyId } }),
  ]);

  if (accountCount + prospectCount === 0) {
    return {
      hotCount: insufficientData,
      warmCount: insufficientData,
      coldCount: insufficientData,
      unscoredCount: insufficientData,
      topHotLeads: insufficientData,
    };
  }

  const [hotCount, warmCount, coldCount, unscoredAccounts, unscoredProspects, topHotScores] = await Promise.all([
    prisma.leadScore.count({ where: { companyId, isLatest: true, classification: "HOT" } }),
    prisma.leadScore.count({ where: { companyId, isLatest: true, classification: "WARM" } }),
    prisma.leadScore.count({ where: { companyId, isLatest: true, classification: "COLD" } }),
    prisma.account.count({ where: { companyId, scores: { none: { isLatest: true } } } }),
    prisma.prospect.count({ where: { companyId, scores: { none: { isLatest: true } } } }),
    prisma.leadScore.findMany({
      where: { companyId, isLatest: true, classification: "HOT" },
      orderBy: { score: "desc" },
      take: 5,
      include: { account: { select: { name: true } }, prospect: { select: { businessName: true } } },
    }),
  ]);

  const topHotLeads: LeadBoardEntryDTO[] = topHotScores.map((s) => ({
    leadType: s.accountId ? "accounts" : "prospects",
    id: (s.accountId ?? s.prospectId) as string,
    name: s.accountId ? (s.account?.name ?? "") : (s.prospect?.businessName ?? ""),
    classification: s.classification,
    score: s.score,
  }));

  return {
    hotCount: ok(hotCount),
    warmCount: ok(warmCount),
    coldCount: ok(coldCount),
    unscoredCount: ok(unscoredAccounts + unscoredProspects),
    topHotLeads: topHotLeads.length > 0 ? ok(topHotLeads) : insufficientData,
  };
}

const BATCH_SCORE_MAX = 25;

export interface BatchScoreItemResult {
  leadType: LeadType;
  id: string;
  name: string;
  result: LeadScoreResult;
}

export interface RunBatchScoringOptions {
  userId: string;
  isPrivilegedCaller: boolean;
  cooldownHours: number;
  ipAddress: string | null;
}

/**
 * Scores up to 25 stale/unscored leads (accounts first, then prospects that
 * pass the insufficient-data gate) sequentially — never fanned out in
 * parallel, per the cost-control requirement.
 */
export async function runBatchScoring(prisma: PrismaClient, companyId: string, opts: RunBatchScoringOptions): Promise<BatchScoreItemResult[]> {
  const staleCutoff = new Date(Date.now() - opts.cooldownHours * 60 * 60 * 1000);
  const staleOrUnscored = [
    { scores: { none: { isLatest: true } } },
    { scores: { some: { isLatest: true, createdAt: { lt: staleCutoff } } } },
  ];

  const accounts = await prisma.account.findMany({
    where: { companyId, OR: staleOrUnscored },
    orderBy: { createdAt: "asc" },
    take: BATCH_SCORE_MAX,
    select: { id: true, name: true },
  });

  const remaining = BATCH_SCORE_MAX - accounts.length;
  const prospects =
    remaining > 0
      ? await prisma.prospect.findMany({
          where: {
            companyId,
            industryId: { not: null },
            OR: [{ stateId: { not: null } }, { cityId: { not: null } }],
            AND: [{ OR: staleOrUnscored }],
          },
          orderBy: { createdAt: "asc" },
          take: remaining,
          select: { id: true, businessName: true },
        })
      : [];

  const results: BatchScoreItemResult[] = [];

  for (const account of accounts) {
    const result = await triggerAccountScore(prisma, companyId, account.id, {
      userId: opts.userId,
      isPrivilegedCaller: opts.isPrivilegedCaller,
      force: false,
      cooldownHours: opts.cooldownHours,
      ipAddress: opts.ipAddress,
    });
    results.push({ leadType: "accounts", id: account.id, name: account.name, result });
  }

  for (const prospect of prospects) {
    const result = await triggerProspectScore(prisma, companyId, prospect.id, {
      userId: opts.userId,
      isPrivilegedCaller: opts.isPrivilegedCaller,
      force: false,
      cooldownHours: opts.cooldownHours,
      ipAddress: opts.ipAddress,
    });
    results.push({ leadType: "prospects", id: prospect.id, name: prospect.businessName, result });
  }

  return results;
}
