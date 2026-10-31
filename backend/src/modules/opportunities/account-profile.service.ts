/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LeadClassification } from "@ai-sales/shared";
import { computeReorderTiming } from "../sales-agent/priority.service.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------
 * Narrow, injectable Prisma-like dependency interface (mirrors
 * SalesAgentPrismaDeps / AssistantPrismaDeps) so profile gathering is
 * unit-testable without a live DB. A real PrismaClient satisfies this
 * structurally — no adapter needed.
 * ---------------------------------------------------------------------- */

export interface OpportunitiesPrismaDeps {
  account: {
    findMany(args: any): Promise<any[]>;
  };
  salesRecord: {
    findMany(args: any): Promise<any[]>;
  };
  leadScore: {
    findMany(args: any): Promise<any[]>;
  };
  product: {
    findMany(args: any): Promise<any[]>;
  };
}

export interface AccountOrder {
  date: Date;
  orderValue: number;
  /** Real Product.id, or null for a legacy/imported SalesRecord with no linked product. */
  productId: string | null;
}

/**
 * One real, fully-computed per-account profile — gathered once per company
 * and reused by every detector in detectors.ts (avoids N+1 queries and
 * duplicated order-stats logic, mirroring the "gather once, compute many"
 * shape already used by sales-agent.service.ts's gatherCandidates and
 * intent-data.service.ts's gatherAccountOrderStats).
 *
 * Deliberately does NOT include anything from Company/CompanyOperatingState/
 * CompanyTargetState — no detector in this phase requires it (see
 * detectors.ts's module comment).
 */
export interface AccountProfile {
  id: string;
  name: string;
  /** Real Account.industryId, or null if unset. */
  industryId: string | null;
  /** Real Industry.name for industryId, for evidence text — or null. */
  industryName: string | null;
  /** Always null — Account has no businessTypeId column (matches Phase 3A's precedent of always passing null for it). */
  businessTypeId: null;
  stateId: string | null;
  /** Every real order for this account, sorted ascending by date. */
  orders: AccountOrder[];
  orderCount: number;
  totalOrderValue: number;
  firstOrderDate: Date | null;
  lastOrderDate: Date | null;
  /** Whole days since lastOrderDate, as of `now`. Null if there is no order at all. */
  recencyDays: number | null;
  /** From computeReorderTiming — null unless there are >=2 real orders. */
  averageReorderIntervalDays: number | null;
  /** From computeReorderTiming — null unless there are >=2 real orders. */
  overdueByDays: number | null;
  /** Real, distinct Product.ids this account has ordered at least once. */
  distinctOwnedProductIds: string[];
  /** From the account's latest LeadScore, copied verbatim — null if never scored. */
  latestScore: number | null;
  latestClassification: LeadClassification | null;
}

export interface CrossSellProductCandidate {
  id: string;
  name: string;
  targetIndustryIds: string[];
  targetBusinessTypeIds: string[];
}

export interface GatheredAccountProfiles {
  profiles: AccountProfile[];
  /** The company's active products with their real target-industry/business-type ids — the only real "product relationship" data this schema has (see detectors.ts's CROSS_SELL comment). */
  products: CrossSellProductCandidate[];
}

function toProductCandidates(products: any[]): CrossSellProductCandidate[] {
  return products.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    targetIndustryIds: (p.targetIndustries ?? []).map((t: any) => t.industryId as string),
    targetBusinessTypeIds: (p.targetBusinessTypes ?? []).map((t: any) => t.businessTypeId as string),
  }));
}

/**
 * One query pass per company: every Account, every real SalesRecord for
 * those accounts, every account's latest LeadScore, and the company's active
 * products — then assembled into one real AccountProfile per account.
 */
export async function gatherAccountProfiles(
  deps: OpportunitiesPrismaDeps,
  companyId: string,
  now: Date,
): Promise<GatheredAccountProfiles> {
  const accounts = await deps.account.findMany({
    where: { companyId },
    select: { id: true, name: true, industryId: true, stateId: true, industry: { select: { name: true } } },
  });

  if (accounts.length === 0) {
    const rawProducts = await deps.product.findMany({
      where: { companyId, isActive: true },
      include: { targetIndustries: true, targetBusinessTypes: true },
    });
    return { profiles: [], products: toProductCandidates(rawProducts) };
  }

  const accountIds = accounts.map((a: any) => a.id as string);

  const [salesRecords, latestScores, rawProducts] = await Promise.all([
    deps.salesRecord.findMany({
      where: { companyId, accountId: { in: accountIds }, cancelledAt: null },
      select: { accountId: true, date: true, orderValue: true, productId: true },
    }),
    deps.leadScore.findMany({
      where: { companyId, accountId: { in: accountIds }, isLatest: true },
      select: { accountId: true, score: true, classification: true },
    }),
    deps.product.findMany({
      where: { companyId, isActive: true },
      include: { targetIndustries: true, targetBusinessTypes: true },
    }),
  ]);

  const ordersByAccount = new Map<string, AccountOrder[]>();
  for (const r of salesRecords as any[]) {
    if (!r.accountId) continue;
    const list = ordersByAccount.get(r.accountId) ?? [];
    list.push({ date: new Date(r.date), orderValue: Number(r.orderValue), productId: r.productId ?? null });
    ordersByAccount.set(r.accountId, list);
  }

  const scoreByAccount = new Map<string, { score: number; classification: LeadClassification }>();
  for (const s of latestScores as any[]) {
    if (!s.accountId) continue;
    scoreByAccount.set(s.accountId, { score: s.score as number, classification: s.classification as LeadClassification });
  }

  const profiles: AccountProfile[] = accounts.map((a: any) => {
    const orders = (ordersByAccount.get(a.id as string) ?? []).slice().sort((x, y) => x.date.getTime() - y.date.getTime());
    const orderCount = orders.length;
    const totalOrderValue = orders.reduce((sum, o) => sum + o.orderValue, 0);
    const firstOrderDate = orderCount > 0 ? orders[0].date : null;
    const lastOrderDate = orderCount > 0 ? orders[orderCount - 1].date : null;
    const recencyDays = lastOrderDate ? Math.round((now.getTime() - lastOrderDate.getTime()) / MS_PER_DAY) : null;
    const { averageReorderIntervalDays, overdueByDays } = computeReorderTiming({
      orderDates: orders.map((o) => o.date),
      recencyDays,
    });
    const distinctOwnedProductIds = Array.from(new Set(orders.map((o) => o.productId).filter((id): id is string => id !== null)));
    const score = scoreByAccount.get(a.id as string) ?? null;

    return {
      id: a.id as string,
      name: a.name as string,
      industryId: a.industryId ?? null,
      industryName: a.industry?.name ?? null,
      businessTypeId: null,
      stateId: a.stateId ?? null,
      orders,
      orderCount,
      totalOrderValue,
      firstOrderDate,
      lastOrderDate,
      recencyDays,
      averageReorderIntervalDays,
      overdueByDays,
      distinctOwnedProductIds,
      latestScore: score?.score ?? null,
      latestClassification: score?.classification ?? null,
    };
  });

  return { profiles, products: toProductCandidates(rawProducts) };
}

/* -------------------------------------------------------------------------
 * Two-period comparison — new for Phase 3C (AT_RISK / GROWING_ACCOUNT need
 * it; no existing module has it). Pure and independently unit-testable, per
 * spec. Windows are half-open and adjacent:
 *   recent window: (now - W, now]
 *   prior window:  (now - 2W, now - W]
 * An order landing exactly on the boundary between the two windows
 * (timestamp === now - W) is counted in the PRIOR window, not the recent one
 * — a deterministic, documented tie-break rather than an accidental one.
 * ---------------------------------------------------------------------- */

export interface WindowComparison {
  recentCount: number;
  recentValue: number;
  priorCount: number;
  priorValue: number;
}

export function computeWindowComparison(
  orders: { date: Date; orderValue: number }[],
  now: Date,
  windowDays: number,
): WindowComparison {
  const nowMs = now.getTime();
  const recentStartMs = nowMs - windowDays * MS_PER_DAY;
  const priorStartMs = nowMs - 2 * windowDays * MS_PER_DAY;

  let recentCount = 0;
  let recentValue = 0;
  let priorCount = 0;
  let priorValue = 0;

  for (const o of orders) {
    const t = o.date.getTime();
    if (t > recentStartMs && t <= nowMs) {
      recentCount += 1;
      recentValue += o.orderValue;
    } else if (t > priorStartMs && t <= recentStartMs) {
      priorCount += 1;
      priorValue += o.orderValue;
    }
  }

  return { recentCount, recentValue, priorCount, priorValue };
}
