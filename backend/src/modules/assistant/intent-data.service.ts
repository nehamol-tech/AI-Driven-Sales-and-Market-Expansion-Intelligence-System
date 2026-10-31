/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AssistantIntentId, AssistantResultItem, LeadClassification } from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import { computeReorderTiming, findMatchingProductNames, type ProductCandidate } from "../sales-agent/priority.service.js";
import { getSalesAgentToday, type SalesAgentPrismaDeps } from "../sales-agent/sales-agent.service.js";
import { SALES_AGENT_DEFAULT_LIMIT } from "../sales-agent/sales-agent.schema.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Caps how many real rows are surfaced per intent — keeps the narration prompt small and the chat answer readable. Mirrors Phase 3A's SALES_AGENT_DEFAULT_LIMIT pattern (today_priorities inherits that limit directly instead of this one). */
export const ASSISTANT_RESULT_LIMIT = 10;

/**
 * Narrow, injectable Prisma-like dependency interface. Structurally a
 * superset of SalesAgentPrismaDeps (leadScore/salesRecord/product), so it
 * can be passed straight into getSalesAgentToday() for the today_priorities
 * intent without an adapter — plus the extra account/prospect access every
 * other intent needs. A real PrismaClient satisfies this structurally, same
 * as SalesAgentPrismaDeps.
 */
export interface AssistantPrismaDeps extends SalesAgentPrismaDeps {
  account: {
    findMany(args: any): Promise<any[]>;
  };
  prospect: {
    findMany(args: any): Promise<any[]>;
  };
}

function formatINR(value: number): string {
  return Math.round(value).toLocaleString("en-IN");
}

/* -------------------------------------------------------------------------
 * Shared account order-stats gathering — reused by reorder_soon,
 * inactive_customers, and high_value_accounts, all of which need the same
 * real per-account order history. Mirrors gatherCandidates()'s "one query
 * pass, then compute" shape in sales-agent.service.ts.
 * ---------------------------------------------------------------------- */

interface AccountOrderStats {
  id: string;
  name: string;
  orderCount: number;
  totalOrderValue: number;
  lastOrderDate: Date | null;
  /** Whole days since lastOrderDate, as of `now`. Null if there is no order at all. */
  recencyDays: number | null;
  /** From computeReorderTiming — null unless there are >=2 real orders. */
  averageReorderIntervalDays: number | null;
  /** From computeReorderTiming — null unless there are >=2 real orders. */
  overdueByDays: number | null;
}

async function gatherAccountOrderStats(deps: AssistantPrismaDeps, companyId: string, now: Date): Promise<AccountOrderStats[]> {
  const accounts = await deps.account.findMany({ where: { companyId }, select: { id: true, name: true } });
  if (accounts.length === 0) return [];

  const accountIds = accounts.map((a: any) => a.id as string);
  const salesRecords = await deps.salesRecord.findMany({
    where: { companyId, accountId: { in: accountIds }, cancelledAt: null },
    select: { accountId: true, date: true, orderValue: true },
  });

  const ordersByAccount = new Map<string, { date: Date; orderValue: number }[]>();
  for (const r of salesRecords as any[]) {
    if (!r.accountId) continue;
    const list = ordersByAccount.get(r.accountId) ?? [];
    list.push({ date: new Date(r.date), orderValue: Number(r.orderValue) });
    ordersByAccount.set(r.accountId, list);
  }

  return accounts.map((a: any) => {
    const orders = ordersByAccount.get(a.id as string) ?? [];
    const orderDates = orders.map((o) => o.date);
    const orderCount = orders.length;
    const totalOrderValue = orders.reduce((sum, o) => sum + o.orderValue, 0);
    const lastOrderDate =
      orderDates.length > 0 ? orderDates.reduce((latest, d) => (d.getTime() > latest.getTime() ? d : latest)) : null;
    const recencyDays = lastOrderDate ? Math.round((now.getTime() - lastOrderDate.getTime()) / MS_PER_DAY) : null;
    const { averageReorderIntervalDays, overdueByDays } = computeReorderTiming({ orderDates, recencyDays });

    return {
      id: a.id as string,
      name: a.name as string,
      orderCount,
      totalOrderValue,
      lastOrderDate,
      recencyDays,
      averageReorderIntervalDays,
      overdueByDays,
    };
  });
}

/* -------------------------------------------------------------------------
 * reorder_soon — accounts with a real, computable reorder cycle (>=2
 * orders) that are already overdue or due within the next week.
 * ---------------------------------------------------------------------- */

function buildReorderDetail(overdueByDays: number, averageReorderIntervalDays: number): string {
  const cycle = Math.round(averageReorderIntervalDays);
  const rounded = Math.round(overdueByDays);
  if (rounded > 0) return `Overdue by ${rounded} day${rounded === 1 ? "" : "s"} (usual cycle ~${cycle} days)`;
  if (rounded === 0) return `Due today (usual cycle ~${cycle} days)`;
  const daysUntilDue = Math.abs(rounded);
  return `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"} (usual cycle ~${cycle} days)`;
}

export async function getReorderSoon(deps: AssistantPrismaDeps, companyId: string, now: Date): Promise<AssistantResultItem[]> {
  const stats = await gatherAccountOrderStats(deps, companyId, now);
  const candidates = stats.filter(
    (s) => s.orderCount >= 2 && s.overdueByDays !== null && s.overdueByDays > -7,
  );
  candidates.sort((a, b) => (b.overdueByDays as number) - (a.overdueByDays as number));

  return candidates.slice(0, ASSISTANT_RESULT_LIMIT).map((s) => ({
    leadId: s.id,
    leadType: "accounts" as const,
    name: s.name,
    score: null,
    classification: null,
    detail: buildReorderDetail(s.overdueByDays as number, s.averageReorderIntervalDays as number),
  }));
}

/* -------------------------------------------------------------------------
 * inactive_customers — a judgment call, kept simple and defensible:
 *
 *  - Accounts with a computable reorder cycle (>=2 real orders): flagged
 *    when overdue by more than 30 days beyond their own usual cycle. 30
 *    days is a round, conservative buffer well past "just barely overdue"
 *    (reorder_soon already surfaces anything from -7 days onward) — this
 *    intent is specifically for customers meaningfully drifting away, not
 *    ones merely due soon.
 *  - Accounts with only 1 real order (no computable cycle to compare
 *    against): flagged when that single order was more than 90 days ago.
 *    90 days (~1 quarter) is an absolute cutoff rather than a cycle-
 *    relative one, since there's no real cadence to measure "meaningfully
 *    overdue" against for a single-order account — an absolute, more
 *    conservative threshold avoids flagging a brand-new customer too
 *    early just because they haven't reordered yet.
 * ---------------------------------------------------------------------- */

export const INACTIVE_OVERDUE_THRESHOLD_DAYS = 30;
export const INACTIVE_SINGLE_ORDER_RECENCY_THRESHOLD_DAYS = 90;

export async function getInactiveCustomers(deps: AssistantPrismaDeps, companyId: string, now: Date): Promise<AssistantResultItem[]> {
  const stats = await gatherAccountOrderStats(deps, companyId, now);

  const candidates = stats.filter((s) => {
    if (s.orderCount >= 2) {
      return s.overdueByDays !== null && s.overdueByDays > INACTIVE_OVERDUE_THRESHOLD_DAYS;
    }
    if (s.orderCount === 1) {
      return s.recencyDays !== null && s.recencyDays > INACTIVE_SINGLE_ORDER_RECENCY_THRESHOLD_DAYS;
    }
    return false; // no real order at all — nothing to flag
  });
  candidates.sort((a, b) => (b.recencyDays ?? 0) - (a.recencyDays ?? 0));

  return candidates.slice(0, ASSISTANT_RESULT_LIMIT).map((s) => ({
    leadId: s.id,
    leadType: "accounts" as const,
    name: s.name,
    score: null,
    classification: null,
    detail:
      s.orderCount >= 2
        ? `No order in ${s.recencyDays} days (usual cycle ~${Math.round(s.averageReorderIntervalDays as number)} days)`
        : `Only order was ${s.recencyDays} days ago`,
  }));
}

/* -------------------------------------------------------------------------
 * high_value_accounts — ranked by real total order value.
 * ---------------------------------------------------------------------- */

export async function getHighValueAccounts(deps: AssistantPrismaDeps, companyId: string, now: Date): Promise<AssistantResultItem[]> {
  const stats = await gatherAccountOrderStats(deps, companyId, now);
  const withOrders = stats.filter((s) => s.orderCount > 0);
  withOrders.sort((a, b) => b.totalOrderValue - a.totalOrderValue);

  return withOrders.slice(0, ASSISTANT_RESULT_LIMIT).map((s) => ({
    leadId: s.id,
    leadType: "accounts" as const,
    name: s.name,
    score: null,
    classification: null,
    detail: `Total order value ₹${formatINR(s.totalOrderValue)} across ${s.orderCount} order${s.orderCount === 1 ? "" : "s"}`,
  }));
}

/* -------------------------------------------------------------------------
 * hot_leads — Accounts + Prospects whose latest LeadScore is HOT.
 * ---------------------------------------------------------------------- */

export async function getHotLeads(deps: AssistantPrismaDeps, companyId: string): Promise<AssistantResultItem[]> {
  const scores = await deps.leadScore.findMany({
    where: { companyId, isLatest: true, classification: "HOT" },
    orderBy: { score: "desc" },
    take: ASSISTANT_RESULT_LIMIT,
    include: { account: { select: { name: true } }, prospect: { select: { businessName: true } } },
  });

  return (scores as any[]).map((s) => ({
    leadId: (s.accountId ?? s.prospectId) as string,
    leadType: (s.accountId ? "accounts" : "prospects") as "accounts" | "prospects",
    name: s.accountId ? ((s.account?.name as string) ?? "") : ((s.prospect?.businessName as string) ?? ""),
    score: s.score as number,
    classification: s.classification as LeadClassification,
    detail: `Score ${s.score}`,
  }));
}

/* -------------------------------------------------------------------------
 * product_recommendations — not a list of leads, a list of products. Each
 * active product is scored by how many current HOT/WARM leads' real
 * industry/business-type data matches it (via findMatchingProductNames,
 * reused per lead exactly as Phase 3A uses it per candidate).
 * ---------------------------------------------------------------------- */

export async function getProductRecommendations(deps: AssistantPrismaDeps, companyId: string): Promise<AssistantResultItem[]> {
  const [leads, products] = await Promise.all([
    deps.leadScore.findMany({
      where: { companyId, isLatest: true, classification: { in: ["HOT", "WARM"] } },
      include: {
        account: { select: { industryId: true } },
        prospect: { select: { industryId: true, businessTypeId: true } },
      },
    }),
    deps.product.findMany({
      where: { companyId, isActive: true },
      include: { targetIndustries: true, targetBusinessTypes: true },
    }),
  ]);

  const candidateProducts: ProductCandidate[] = (products as any[]).map((p) => ({
    name: p.name as string,
    targetIndustryIds: (p.targetIndustries ?? []).map((t: any) => t.industryId as string),
    targetBusinessTypeIds: (p.targetBusinessTypes ?? []).map((t: any) => t.businessTypeId as string),
  }));
  const productIdByName = new Map((products as any[]).map((p) => [p.name as string, p.id as string]));

  const tally = new Map<string, number>();
  for (const p of candidateProducts) tally.set(p.name, 0);

  for (const s of leads as any[]) {
    const isAccount = Boolean(s.accountId);
    const industryId = isAccount ? ((s.account?.industryId as string | null) ?? null) : ((s.prospect?.industryId as string | null) ?? null);
    const businessTypeId = isAccount ? null : ((s.prospect?.businessTypeId as string | null) ?? null);
    const matches = findMatchingProductNames(candidateProducts, industryId, businessTypeId);
    for (const name of matches) {
      tally.set(name, (tally.get(name) ?? 0) + 1);
    }
  }

  return Array.from(tally.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, ASSISTANT_RESULT_LIMIT)
    .map(([name, count]) => ({
      // This intent's results are products, not leads — AssistantResultItem
      // is lead-shaped, but reused here per spec rather than introducing a
      // parallel result type. leadId is the product's own real id (a
      // stable, unique value safe for a React key); leadType "accounts" is
      // an arbitrary placeholder the frontend is not expected to treat as
      // a real lead-detail link for this intent.
      leadId: productIdByName.get(name) ?? name,
      leadType: "accounts" as const,
      name,
      score: null,
      classification: null,
      detail: `Matches ${count} current HOT/WARM lead${count === 1 ? "" : "s"}`,
    }));
}

/* -------------------------------------------------------------------------
 * today_priorities — reuses getSalesAgentToday() directly, including its
 * own daily cache. This is the one intent whose data-gathering step can
 * itself trigger Phase 3A's own AI narrative pipeline (only on a cache
 * miss) — the assistant's own narration step (assistant.service.ts) then
 * narrates on top of that already-real, already-cached result.
 * ---------------------------------------------------------------------- */

async function getTodayPriorities(deps: AssistantPrismaDeps, aiProvider: AIProvider, companyId: string, now: Date): Promise<AssistantResultItem[]> {
  const { dto } = await getSalesAgentToday(deps, aiProvider, {
    companyId,
    limit: SALES_AGENT_DEFAULT_LIMIT,
    force: false,
    now,
  });

  return dto.priorities.map((p) => ({
    leadId: p.leadId,
    leadType: p.leadType,
    name: p.name,
    score: p.score,
    classification: p.classification,
    detail: p.recommendedAction,
  }));
}

/* -------------------------------------------------------------------------
 * Dispatcher
 * ---------------------------------------------------------------------- */

export async function gatherIntentData(
  deps: AssistantPrismaDeps,
  aiProvider: AIProvider,
  companyId: string,
  intentId: AssistantIntentId,
  now: Date = new Date(),
): Promise<AssistantResultItem[]> {
  switch (intentId) {
    case "today_priorities":
      return getTodayPriorities(deps, aiProvider, companyId, now);
    case "reorder_soon":
      return getReorderSoon(deps, companyId, now);
    case "inactive_customers":
      return getInactiveCustomers(deps, companyId, now);
    case "hot_leads":
      return getHotLeads(deps, companyId);
    case "product_recommendations":
      return getProductRecommendations(deps, companyId);
    case "high_value_accounts":
      return getHighValueAccounts(deps, companyId, now);
    default: {
      const exhaustiveCheck: never = intentId;
      throw new Error(`Unhandled assistant intent: ${String(exhaustiveCheck)}`);
    }
  }
}
