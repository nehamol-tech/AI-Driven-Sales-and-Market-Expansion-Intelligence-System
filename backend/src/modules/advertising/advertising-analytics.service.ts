/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AdCampaignSource, AdPlatform, CampaignAnalyticsDTO, MetricValue, ScoreMethod } from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import { normalizeAccountName } from "../leads/account-resolution.service.js";
import { buildAdvertisingAnalyticsPrompt, type AdvertisingAnalyticsEvidence } from "./advertising-analytics.prompt.js";
import { parseAIAdvertisingNarrative } from "./advertising-analytics.schema.js";

/**
 * Narrow, injectable Prisma-like dependency interface (mirrors
 * RevenueAnalyticsPrismaDeps) so this whole module is unit-testable without
 * a live DB.
 */
export interface AdvertisingAnalyticsPrismaDeps {
  adCampaign: {
    findMany(args: any): Promise<any[]>;
  };
  adSpendRecord: {
    aggregate(args: any): Promise<any>;
  };
  prospect: {
    count(args: any): Promise<number>;
    findMany(args: any): Promise<any[]>;
  };
  account: {
    findUnique(args: any): Promise<any | null>;
  };
  salesRecord: {
    aggregate(args: any): Promise<any>;
  };
}

export interface CampaignRow {
  id: string;
  name: string;
  platform: AdPlatform;
  source: AdCampaignSource;
  startDate: Date;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Revenue attribution: only WON prospects on this campaign are considered.
 * Each is matched to a real Account via normalizeAccountName — reused
 * READ-ONLY from account-resolution.service.ts, never reimplemented, never
 * creates an Account here (a lookup miss simply means "no match", not "make
 * one up"). Multiple WON prospects that resolve to the SAME Account are only
 * counted once: summing that Account's real revenue twice because two
 * prospects happened to share a business name would inflate the number
 * beyond what actually happened, which this codebase's data-honesty
 * principle forbids just as much as fabricating a number outright. Revenue
 * is scoped to `date >= campaign.startDate` — only orders placed since the
 * campaign began count toward it. Returns `insufficient_data` when there are
 * zero WON prospects OR zero of them match a real Account.
 */
async function computeAttributedRevenue(
  deps: AdvertisingAnalyticsPrismaDeps,
  companyId: string,
  campaign: CampaignRow,
  leadsWon: number,
): Promise<MetricValue<string>> {
  if (leadsWon === 0) return { status: "insufficient_data" };

  const wonProspects = (await deps.prospect.findMany({
    where: { companyId, campaignId: campaign.id, status: "WON" },
    select: { businessName: true },
  })) as { businessName: string }[];

  const matchedAccountIds = new Set<string>();
  for (const p of wonProspects) {
    const normalizedName = normalizeAccountName(p.businessName);
    const account = await deps.account.findUnique({ where: { companyId_normalizedName: { companyId, normalizedName } } });
    if (account) matchedAccountIds.add(account.id as string);
  }

  if (matchedAccountIds.size === 0) return { status: "insufficient_data" };

  let revenueSum = 0;
  for (const accountId of matchedAccountIds) {
    const salesAgg = await deps.salesRecord.aggregate({
      where: { companyId, accountId, date: { gte: campaign.startDate }, cancelledAt: null },
      _sum: { orderValue: true },
    });
    revenueSum += Number(salesAgg?._sum?.orderValue ?? 0);
  }

  return { status: "ok", value: String(Math.round(revenueSum)) };
}

/**
 * Computes every deterministic metric for one campaign. `totalSpend`/
 * `leadsGenerated`/`leadsWon` are always fully known real counts/sums — only
 * `costPerLead`/`attributedRevenue`/`roas` can legitimately be
 * `insufficient_data`.
 */
export async function computeCampaignAnalytics(deps: AdvertisingAnalyticsPrismaDeps, companyId: string, campaign: CampaignRow): Promise<CampaignAnalyticsDTO> {
  const [spendAgg, leadsGenerated, leadsWon] = await Promise.all([
    deps.adSpendRecord.aggregate({ where: { campaignId: campaign.id }, _sum: { amount: true } }),
    deps.prospect.count({ where: { companyId, campaignId: campaign.id } }),
    deps.prospect.count({ where: { companyId, campaignId: campaign.id, status: "WON" } }),
  ]);

  const totalSpend = round2(Number(spendAgg?._sum?.amount ?? 0));

  const costPerLead: MetricValue<string> =
    leadsGenerated === 0 ? { status: "insufficient_data" } : { status: "ok", value: String(round2(totalSpend / leadsGenerated)) };

  const attributedRevenue = await computeAttributedRevenue(deps, companyId, campaign, leadsWon);

  const roas: MetricValue<number> =
    attributedRevenue.status === "ok" && totalSpend > 0
      ? { status: "ok", value: round2(Number(attributedRevenue.value) / totalSpend) }
      : { status: "insufficient_data" };

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    platform: campaign.platform,
    source: campaign.source,
    totalSpend: String(totalSpend),
    leadsGenerated,
    leadsWon,
    costPerLead,
    attributedRevenue,
    roas,
  };
}

/* -------------------------------------------------------------------------
 * Always-hedged, real-evidence-only rule-based narrative — mirrors
 * revenue-analytics.service.ts's buildRuleBasedNarrative exactly in spirit.
 * ---------------------------------------------------------------------- */

function isOk<T>(m: MetricValue<T>): m is { status: "ok"; value: T } {
  return m.status === "ok";
}

function buildRuleBasedNarrative(evidence: AdvertisingAnalyticsEvidence): string {
  const campaigns = evidence.campaigns;
  const bits: string[] = [`This company has ${campaigns.length} active ad campaign${campaigns.length === 1 ? "" : "s"} with recorded spend on file.`];

  const totalSpend = campaigns.reduce((sum, c) => sum + Number(c.totalSpend), 0);
  bits.push(`Combined real spend across these campaigns is ₹${Math.round(totalSpend).toLocaleString("en-IN")}.`);

  const withKnownRoas = campaigns.filter((c) => isOk(c.roas));
  if (withKnownRoas.length > 0) {
    const best = withKnownRoas.reduce((a, b) => ((a.roas as { value: number }).value >= (b.roas as { value: number }).value ? a : b));
    bits.push(
      `${JSON.stringify(best.campaignName)} has the strongest known return so far at ${(best.roas as { value: number }).value.toFixed(2)}x — based on won leads matched to a real account with recorded revenue, which may not capture every real conversion.`,
    );
  } else {
    bits.push(
      "None of these campaigns yet have enough real evidence (a won lead matched to an existing account with recorded revenue) to compute a reliable return on ad spend.",
    );
  }

  return bits.join(" ");
}

/* -------------------------------------------------------------------------
 * AI narrative call + validation + retry + fallback — mirrors
 * revenue-analytics.service.ts's callRevenueAnalyticsAIOnce/
 * runRevenueNarrativePipeline structure exactly.
 * ---------------------------------------------------------------------- */

const ADVERTISING_ANALYTICS_AI_MAX_TOKENS = 1000;

async function callAdvertisingAnalyticsAIOnce(aiProvider: AIProvider, evidence: AdvertisingAnalyticsEvidence): Promise<string | null> {
  try {
    const prompt = buildAdvertisingAnalyticsPrompt(evidence);
    const completion = await aiProvider.generateCompletion(prompt, { maxTokens: ADVERTISING_ANALYTICS_AI_MAX_TOKENS, temperature: 0.3 });
    const parsed = parseAIAdvertisingNarrative(completion.content);
    return parsed ? parsed.narrative : null;
  } catch {
    return null;
  }
}

export interface AdvertisingNarrativePipelineResult {
  /** null only when there are zero active campaigns to narrate (the AI is never called in that case). */
  narrative: string | null;
  method: ScoreMethod;
}

/**
 * Calls the AI provider once, validates its JSON output, retries once on
 * failure/invalid output, then falls back to the transparent RULE_BASED
 * template — never a silent failure. Zero active campaigns -> zero AI calls.
 */
export async function runAdvertisingNarrativePipeline(aiProvider: AIProvider, evidence: AdvertisingAnalyticsEvidence): Promise<AdvertisingNarrativePipelineResult> {
  if (evidence.campaigns.length === 0) {
    return { narrative: null, method: "RULE_BASED" };
  }

  let narrative = await callAdvertisingAnalyticsAIOnce(aiProvider, evidence);
  if (!narrative) {
    narrative = await callAdvertisingAnalyticsAIOnce(aiProvider, evidence); // one retry
  }

  if (narrative) {
    return { narrative, method: "AI" };
  }

  return { narrative: buildRuleBasedNarrative(evidence), method: "RULE_BASED" };
}

/* -------------------------------------------------------------------------
 * Generation — gathers every real active campaign + its computed metrics,
 * narrates via the AI/fallback pipeline. Note: unlike revenue-analytics,
 * this service intentionally does NOT own `connections` — that stays a
 * live, uncached read via ad-connections.service.ts (composed in by
 * advertising-analytics.controller.ts), since connection status changing
 * (e.g. right after an admin connects an account) shouldn't have to wait
 * for tomorrow's cache refresh or a force=true call the way the AI
 * narrative legitimately can.
 * ---------------------------------------------------------------------- */

async function generate(
  deps: AdvertisingAnalyticsPrismaDeps,
  aiProvider: AIProvider,
  companyId: string,
): Promise<{ campaigns: CampaignAnalyticsDTO[]; narrative: string | null; method: ScoreMethod }> {
  const activeCampaigns = await deps.adCampaign.findMany({ where: { companyId, isActive: true }, orderBy: { createdAt: "desc" } });

  const campaigns = await Promise.all(
    (activeCampaigns as any[]).map((c) =>
      computeCampaignAnalytics(deps, companyId, {
        id: c.id,
        name: c.name,
        platform: c.platform,
        source: c.source,
        startDate: c.startDate instanceof Date ? c.startDate : new Date(c.startDate),
      }),
    ),
  );

  const evidence: AdvertisingAnalyticsEvidence = { campaigns };
  const { narrative, method } = await runAdvertisingNarrativePipeline(aiProvider, evidence);

  return { campaigns, narrative, method };
}

/* -------------------------------------------------------------------------
 * In-memory per-company daily cache — same shape/tradeoffs as
 * revenue-analytics.service.ts's cache.
 * ---------------------------------------------------------------------- */

interface CacheEntry {
  campaigns: CampaignAnalyticsDTO[];
  narrative: string | null;
  method: ScoreMethod;
  date: string; // YYYY-MM-DD
}

const cache = new Map<string, CacheEntry>();

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Cheap, I/O-free cache peek used by the route layer (mirrors revenue-analytics.routes.ts's rateLimitIfGenerating pattern exactly). */
export function willRequireGeneration(companyId: string, force: boolean, now: Date = new Date()): boolean {
  if (force) return true;
  const entry = cache.get(companyId);
  return !entry || entry.date !== toDateKey(now);
}

/** Test-only: resets the module-level cache between test cases. */
export function clearAdvertisingAnalyticsCache(): void {
  cache.clear();
}

async function getOrGenerate(
  deps: AdvertisingAnalyticsPrismaDeps,
  aiProvider: AIProvider,
  companyId: string,
  force: boolean,
  now: Date,
): Promise<{ entry: CacheEntry; wasGenerated: boolean }> {
  const dateKey = toDateKey(now);
  const cached = !force ? cache.get(companyId) : undefined;
  if (cached && cached.date === dateKey) {
    return { entry: cached, wasGenerated: false };
  }
  const { campaigns, narrative, method } = await generate(deps, aiProvider, companyId);
  const entry: CacheEntry = { campaigns, narrative, method, date: dateKey };
  cache.set(companyId, entry);
  return { entry, wasGenerated: true };
}

export interface GetAdvertisingAnalyticsParams {
  companyId: string;
  force: boolean;
  now?: Date;
}

export interface GetAdvertisingAnalyticsResult {
  campaigns: CampaignAnalyticsDTO[];
  narrative: string | null;
  method: ScoreMethod;
  wasGenerated: boolean;
}

/**
 * Top-level orchestration for GET /api/advertising/analytics: serves the
 * cached campaigns+narrative for today if present (unless force=true),
 * otherwise recomputes every active campaign's real metrics, narrates via
 * the AI/fallback pipeline, caches the result for the rest of today.
 */
export async function getAdvertisingAnalytics(
  deps: AdvertisingAnalyticsPrismaDeps,
  aiProvider: AIProvider,
  params: GetAdvertisingAnalyticsParams,
): Promise<GetAdvertisingAnalyticsResult> {
  const now = params.now ?? new Date();
  const { entry, wasGenerated } = await getOrGenerate(deps, aiProvider, params.companyId, params.force, now);
  return { campaigns: entry.campaigns, narrative: entry.narrative, method: entry.method, wasGenerated };
}
