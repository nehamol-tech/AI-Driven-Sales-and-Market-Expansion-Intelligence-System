import type { Prisma, PrismaClient } from "@prisma/client";
import type { AccountDTO, LeadScoreDTO, LeadScoreResult } from "@ai-sales/shared";
import { NotFoundError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import { toAccountDTO, toLeadScoreDTO } from "./leads.dto.js";
import * as scoringService from "./scoring.service.js";
import type { ListAccountsQuery } from "./accounts.schema.js";

const accountInclude = {
  state: { select: { name: true } },
  city: { select: { name: true } },
  industry: { select: { name: true } },
} satisfies Prisma.AccountInclude;

interface OrderAggregate {
  orderCount: number;
  totalOrderValue: string;
  lastOrderDate: Date | null;
}

async function aggregateOrdersFor(prisma: PrismaClient, companyId: string, accountIds: string[]): Promise<Map<string, OrderAggregate>> {
  if (accountIds.length === 0) return new Map();
  const groups = await prisma.salesRecord.groupBy({
    by: ["accountId"],
    where: { companyId, accountId: { in: accountIds } },
    _count: { _all: true },
    _sum: { orderValue: true },
    _max: { date: true },
  });
  const map = new Map<string, OrderAggregate>();
  for (const g of groups) {
    if (!g.accountId) continue;
    map.set(g.accountId, {
      orderCount: g._count._all,
      totalOrderValue: g._sum.orderValue ? String(g._sum.orderValue) : "0",
      lastOrderDate: g._max.date ?? null,
    });
  }
  return map;
}

export interface PaginatedAccounts {
  items: AccountDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listAccounts(prisma: PrismaClient, companyId: string, query: ListAccountsQuery): Promise<PaginatedAccounts> {
  let scoresFilter: Prisma.AccountWhereInput["scores"] | undefined;
  if (query.hasScore === false) {
    scoresFilter = { none: { isLatest: true } };
  } else if (query.classification !== undefined || query.minScore !== undefined || query.hasScore === true) {
    scoresFilter = {
      some: {
        isLatest: true,
        ...(query.classification ? { classification: query.classification } : {}),
        ...(query.minScore !== undefined ? { score: { gte: query.minScore } } : {}),
      },
    };
  }

  const where: Prisma.AccountWhereInput = {
    companyId,
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
    ...(scoresFilter ? { scores: scoresFilter } : {}),
  };

  const [accounts, total] = await Promise.all([
    prisma.account.findMany({
      where,
      include: accountInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.account.count({ where }),
  ]);

  const accountIds = accounts.map((a) => a.id);
  const [aggregates, latestScores] = await Promise.all([
    aggregateOrdersFor(prisma, companyId, accountIds),
    accountIds.length > 0
      ? prisma.leadScore.findMany({ where: { companyId, accountId: { in: accountIds }, isLatest: true } })
      : Promise.resolve([]),
  ]);
  const scoreByAccount = new Map(latestScores.map((s) => [s.accountId as string, s]));

  const items = accounts.map((a) =>
    toAccountDTO(
      a,
      aggregates.get(a.id) ?? { orderCount: 0, totalOrderValue: "0", lastOrderDate: null },
      scoreByAccount.get(a.id) ?? null,
    ),
  );

  return { items, total, page: query.page, pageSize: query.pageSize };
}

export interface AccountDetail {
  account: AccountDTO;
  scoreHistory: LeadScoreDTO[];
}

export async function getAccountById(prisma: PrismaClient, companyId: string, id: string): Promise<AccountDetail> {
  const account = await prisma.account.findFirst({ where: { id, companyId }, include: accountInclude });
  if (!account) {
    throw new NotFoundError("Account not found");
  }

  const [aggMap, scores] = await Promise.all([
    aggregateOrdersFor(prisma, companyId, [id]),
    prisma.leadScore.findMany({ where: { companyId, accountId: id }, orderBy: { createdAt: "desc" } }),
  ]);

  const latestScore = scores.find((s) => s.isLatest) ?? null;
  const accountDTO = toAccountDTO(account, aggMap.get(id) ?? { orderCount: 0, totalOrderValue: "0", lastOrderDate: null }, latestScore);

  return { account: accountDTO, scoreHistory: scores.map(toLeadScoreDTO) };
}

export interface TriggerAccountScoreOptions {
  userId: string;
  isPrivilegedCaller: boolean;
  force: boolean;
  cooldownHours: number;
  ipAddress: string | null;
}

/**
 * Triggers (re)scoring of an Account. Accounts always qualify (they exist
 * because of a real sale), so this can only resolve to `ok` or short-circuit
 * via the cooldown to the existing latest score — never insufficient_data.
 */
export async function triggerAccountScore(
  prisma: PrismaClient,
  companyId: string,
  accountId: string,
  opts: TriggerAccountScoreOptions,
): Promise<LeadScoreResult> {
  const aiProvider = createAIProvider();
  const outcome = await scoringService.scoreAccount(prisma, aiProvider, {
    companyId,
    leadId: accountId,
    force: opts.force,
    isPrivilegedCaller: opts.isPrivilegedCaller,
    cooldownHours: opts.cooldownHours,
  });

  if (outcome.status === "not_found") {
    throw new NotFoundError("Account not found");
  }
  if (outcome.status === "insufficient_data") {
    // Unreachable for Account in practice (kept for type exhaustiveness with scoreProspect's shared return type).
    return { status: "insufficient_data", missing: outcome.missing };
  }
  if (outcome.status === "cooldown") {
    return { status: "ok", score: toLeadScoreDTO(outcome.latestScore) };
  }

  const created = await scoringService.persistLeadScore(prisma, {
    companyId,
    accountId,
    createdById: opts.userId,
    pipelineResult: outcome.pipelineResult,
    inputFeatures: outcome.inputFeatures,
  });

  await logAudit(
    {
      userId: opts.userId,
      action: "LEAD_SCORE_COMPUTED",
      entityType: "Account",
      entityId: accountId,
      metadata: {
        score: outcome.pipelineResult.score,
        classification: outcome.pipelineResult.classification,
        method: outcome.pipelineResult.method,
      },
      ipAddress: opts.ipAddress,
    },
    prisma,
  );

  return { status: "ok", score: toLeadScoreDTO(created) };
}
