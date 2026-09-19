/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LeadClassification } from "@ai-sales/shared";

/* -------------------------------------------------------------------------
 * Narrow, injectable Prisma-like dependency interface (mirrors
 * OpportunitiesPrismaDeps / SalesAgentPrismaDeps) so profile gathering is
 * unit-testable without a live DB. A real PrismaClient satisfies this
 * structurally — no adapter needed.
 *
 * Deliberately does NOT include Company / CompanyOperatingState /
 * CompanyTargetState — no part of this feature reads them (see the Phase 4
 * spec's explicit "company details are not required" constraint, mirroring
 * Phase 3C's precedent for detectors.ts).
 * ---------------------------------------------------------------------- */

export interface MarketExpansionPrismaDeps {
  state: {
    findMany(args: any): Promise<any[]>;
  };
  salesRecord: {
    findMany(args: any): Promise<any[]>;
  };
  account: {
    findMany(args: any): Promise<any[]>;
  };
  prospect: {
    findMany(args: any): Promise<any[]>;
  };
  leadScore: {
    findMany(args: any): Promise<any[]>;
  };
  product: {
    findMany(args: any): Promise<any[]>;
  };
}

export interface StateOrder {
  date: Date;
  orderValue: number;
}

/** One real industry's performance within one state, from actual SalesRecord + Account data. */
export interface StateIndustryBreakdown {
  industryId: string;
  industryName: string;
  /** Real Account.industryId count within this state — independent of whether those accounts have ordered yet. */
  accountCount: number;
  orderCount: number;
  totalValue: number;
}

export interface StateCityBreakdown {
  cityId: string;
  cityName: string;
  orderCount: number;
  totalValue: number;
}

export interface StateProductBreakdown {
  productId: string;
  productName: string;
  orderCount: number;
  totalValue: number;
}

/**
 * One real, fully-computed per-state profile — gathered once per company and
 * reused by scoring (market-scoring.ts) and hypothesis generation
 * (expansion-signals.ts). All monetary fields are raw numbers; string
 * formatting for the DTO happens only at the very end in
 * market-expansion.service.ts (mirrors account-profile.service.ts's
 * AccountProfile convention).
 */
export interface StateProfile {
  stateId: string;
  stateName: string;
  accountCount: number;
  prospectCount: number;
  orderCount: number;
  totalSalesValue: number;
  averageOrderValue: number | null;
  hotAccountCount: number;
  warmAccountCount: number;
  /** Sorted totalValue desc. */
  industryBreakdown: StateIndustryBreakdown[];
  topIndustry: StateIndustryBreakdown | null;
  /** Sorted totalValue desc. */
  cityBreakdown: StateCityBreakdown[];
  /** Sorted totalValue desc. Only records with a real productId. */
  productBreakdown: StateProductBreakdown[];
  /** Every real order in this state, for computeWindowComparison-based growth analysis. */
  orders: StateOrder[];
  /** Real industryIds with at least one real SalesRecord in this state — used by product-fit/whitespace scoring and expansion hypotheses. */
  distinctRealIndustryIds: string[];
}

export interface ProductCandidate {
  id: string;
  name: string;
  /** Real Industry.ids this product targets (ProductTargetIndustry). */
  targetIndustryIds: string[];
}

export interface GatheredStateProfiles {
  profiles: StateProfile[];
  /** The company's active products with their real target-industry ids. */
  products: ProductCandidate[];
}

function toProductCandidates(products: any[]): ProductCandidate[] {
  return products.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    targetIndustryIds: (p.targetIndustries ?? []).map((t: any) => t.industryId as string),
  }));
}

interface RawOrder {
  cityId: string | null;
  cityName: string | null;
  industryId: string | null;
  industryName: string | null;
  productId: string | null;
  productName: string | null;
  date: Date;
  orderValue: number;
}

/**
 * One query pass across the whole company: every seeded State (all ~36,
 * regardless of data), every real SalesRecord (grouped by its own stateId —
 * SalesRecord carries stateId/cityId/industryId directly, so this never
 * needs to join through Account), every Account/Prospect (grouped by
 * stateId), every account's latest LeadScore, and the company's active
 * Products (with target-industry joins) — then assembled into one real
 * StateProfile per state.
 */
export async function gatherStateProfiles(deps: MarketExpansionPrismaDeps, companyId: string): Promise<GatheredStateProfiles> {
  const [states, accounts, prospects, rawProducts] = await Promise.all([
    deps.state.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    deps.account.findMany({ where: { companyId }, select: { id: true, stateId: true, industryId: true } }),
    deps.prospect.findMany({ where: { companyId }, select: { id: true, stateId: true } }),
    deps.product.findMany({ where: { companyId, isActive: true }, include: { targetIndustries: true } }),
  ]);

  const accountIds = (accounts as any[]).map((a) => a.id as string);

  const [salesRecords, latestScores] = await Promise.all([
    deps.salesRecord.findMany({
      where: { companyId, stateId: { not: null } },
      select: {
        stateId: true,
        cityId: true,
        industryId: true,
        productId: true,
        date: true,
        orderValue: true,
        city: { select: { name: true } },
        industry: { select: { name: true } },
        product: { select: { name: true } },
      },
    }),
    accountIds.length > 0
      ? deps.leadScore.findMany({ where: { companyId, accountId: { in: accountIds }, isLatest: true }, select: { accountId: true, classification: true } })
      : Promise.resolve([]),
  ]);

  const scoreByAccount = new Map<string, LeadClassification>();
  for (const s of latestScores as any[]) {
    if (!s.accountId) continue;
    scoreByAccount.set(s.accountId, s.classification as LeadClassification);
  }

  const accountsByState = new Map<string, { id: string; industryId: string | null }[]>();
  for (const a of accounts as any[]) {
    if (!a.stateId) continue;
    const list = accountsByState.get(a.stateId) ?? [];
    list.push({ id: a.id as string, industryId: a.industryId ?? null });
    accountsByState.set(a.stateId, list);
  }

  const prospectCountByState = new Map<string, number>();
  for (const p of prospects as any[]) {
    if (!p.stateId) continue;
    prospectCountByState.set(p.stateId, (prospectCountByState.get(p.stateId) ?? 0) + 1);
  }

  const ordersByState = new Map<string, RawOrder[]>();
  for (const r of salesRecords as any[]) {
    if (!r.stateId) continue;
    const list = ordersByState.get(r.stateId) ?? [];
    list.push({
      cityId: r.cityId ?? null,
      cityName: r.city?.name ?? null,
      industryId: r.industryId ?? null,
      industryName: r.industry?.name ?? null,
      productId: r.productId ?? null,
      productName: r.product?.name ?? null,
      date: new Date(r.date),
      orderValue: Number(r.orderValue),
    });
    ordersByState.set(r.stateId, list);
  }

  const profiles: StateProfile[] = (states as any[]).map((s) => {
    const stateId = s.id as string;
    const stateName = s.name as string;
    const stateAccounts = accountsByState.get(stateId) ?? [];
    const accountCount = stateAccounts.length;
    const prospectCount = prospectCountByState.get(stateId) ?? 0;

    let hotAccountCount = 0;
    let warmAccountCount = 0;
    for (const a of stateAccounts) {
      const cls = scoreByAccount.get(a.id);
      if (cls === "HOT") hotAccountCount += 1;
      else if (cls === "WARM") warmAccountCount += 1;
    }

    const stateOrders = ordersByState.get(stateId) ?? [];
    const orderCount = stateOrders.length;
    const totalSalesValue = stateOrders.reduce((sum, o) => sum + o.orderValue, 0);
    const averageOrderValue = orderCount > 0 ? totalSalesValue / orderCount : null;

    const accountCountByIndustry = new Map<string, number>();
    for (const a of stateAccounts) {
      if (!a.industryId) continue;
      accountCountByIndustry.set(a.industryId, (accountCountByIndustry.get(a.industryId) ?? 0) + 1);
    }

    const industryAgg = new Map<string, { industryName: string; orderCount: number; totalValue: number }>();
    for (const o of stateOrders) {
      if (!o.industryId) continue;
      const entry = industryAgg.get(o.industryId) ?? { industryName: o.industryName ?? "Unknown industry", orderCount: 0, totalValue: 0 };
      entry.orderCount += 1;
      entry.totalValue += o.orderValue;
      industryAgg.set(o.industryId, entry);
    }
    const industryBreakdown: StateIndustryBreakdown[] = Array.from(industryAgg.entries())
      .map(([industryId, v]) => ({
        industryId,
        industryName: v.industryName,
        accountCount: accountCountByIndustry.get(industryId) ?? 0,
        orderCount: v.orderCount,
        totalValue: v.totalValue,
      }))
      .sort((a, b) => b.totalValue - a.totalValue);
    const topIndustry = industryBreakdown[0] ?? null;

    const cityAgg = new Map<string, { cityName: string; orderCount: number; totalValue: number }>();
    for (const o of stateOrders) {
      if (!o.cityId) continue;
      const entry = cityAgg.get(o.cityId) ?? { cityName: o.cityName ?? "Unknown city", orderCount: 0, totalValue: 0 };
      entry.orderCount += 1;
      entry.totalValue += o.orderValue;
      cityAgg.set(o.cityId, entry);
    }
    const cityBreakdown: StateCityBreakdown[] = Array.from(cityAgg.entries())
      .map(([cityId, v]) => ({ cityId, cityName: v.cityName, orderCount: v.orderCount, totalValue: v.totalValue }))
      .sort((a, b) => b.totalValue - a.totalValue);

    const productAgg = new Map<string, { productName: string; orderCount: number; totalValue: number }>();
    for (const o of stateOrders) {
      if (!o.productId) continue;
      const entry = productAgg.get(o.productId) ?? { productName: o.productName ?? "Unknown product", orderCount: 0, totalValue: 0 };
      entry.orderCount += 1;
      entry.totalValue += o.orderValue;
      productAgg.set(o.productId, entry);
    }
    const productBreakdown: StateProductBreakdown[] = Array.from(productAgg.entries())
      .map(([productId, v]) => ({ productId, productName: v.productName, orderCount: v.orderCount, totalValue: v.totalValue }))
      .sort((a, b) => b.totalValue - a.totalValue);

    return {
      stateId,
      stateName,
      accountCount,
      prospectCount,
      orderCount,
      totalSalesValue,
      averageOrderValue,
      hotAccountCount,
      warmAccountCount,
      industryBreakdown,
      topIndustry,
      cityBreakdown,
      productBreakdown,
      orders: stateOrders.map((o) => ({ date: o.date, orderValue: o.orderValue })),
      distinctRealIndustryIds: industryBreakdown.map((i) => i.industryId),
    };
  });

  return { profiles, products: toProductCandidates(rawProducts) };
}
