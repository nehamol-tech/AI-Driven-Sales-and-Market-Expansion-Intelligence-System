/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";
import type { LeadClassification, LeadScoreReason, LeadScoreRecommendedAction, ScoreMethod } from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import { buildLeadScoringPrompt, LEAD_SCORING_PROMPT_VERSION, type LeadScoringPromptInput } from "../../lib/ai/prompts/lead-scoring.prompt.js";
import { parseAIScoreResponse } from "./scoring.schema.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------------
 * Feature computation (pure, no AI, no I/O) — always real numbers.
 * ---------------------------------------------------------------------- */

export interface RawOrder {
  date: Date;
  orderValue: number;
}

export interface FeatureComputationInput {
  now: Date;
  industryId: string | null;
  businessTypeId: string | null;
  stateId: string | null;
  orders: RawOrder[];
  /** Every active product the company sells, with its target industry/business-type ids. */
  companyProducts: { targetIndustryIds: string[]; targetBusinessTypeIds: string[] }[];
  operatingStateIds: string[];
  targetStateIds: string[];
}

export type StateAlignment = "operating" | "target" | "none" | "unknown";

export interface LeadInputFeatures {
  recencyDays: number | null;
  orderCount: number;
  totalOrderValue: number;
  averageOrderValue: number | null;
  productFitScore: number;
  stateAlignment: StateAlignment;
}

export function computeInputFeatures(input: FeatureComputationInput): LeadInputFeatures {
  const orderCount = input.orders.length;
  const totalOrderValue = round2(input.orders.reduce((sum, o) => sum + o.orderValue, 0));
  const averageOrderValue = orderCount > 0 ? round2(totalOrderValue / orderCount) : null;

  let recencyDays: number | null = null;
  if (orderCount > 0) {
    const mostRecentMs = Math.max(...input.orders.map((o) => o.date.getTime()));
    recencyDays = Math.max(0, Math.floor((input.now.getTime() - mostRecentMs) / MS_PER_DAY));
  }

  const totalProducts = input.companyProducts.length;
  let productFitScore = 0;
  if (totalProducts > 0 && (input.industryId || input.businessTypeId)) {
    const matching = input.companyProducts.filter(
      (p) =>
        (input.industryId !== null && p.targetIndustryIds.includes(input.industryId)) ||
        (input.businessTypeId !== null && p.targetBusinessTypeIds.includes(input.businessTypeId)),
    ).length;
    productFitScore = round2(matching / totalProducts);
  }

  let stateAlignment: StateAlignment = "unknown";
  if (input.stateId) {
    if (input.operatingStateIds.includes(input.stateId)) {
      stateAlignment = "operating";
    } else if (input.targetStateIds.includes(input.stateId)) {
      stateAlignment = "target";
    } else {
      stateAlignment = "none";
    }
  }

  return { recencyDays, orderCount, totalOrderValue, averageOrderValue, productFitScore, stateAlignment };
}

/* -------------------------------------------------------------------------
 * Deterministic classification — never trusted from the AI's own output.
 * ---------------------------------------------------------------------- */

export function classifyScore(score: number): LeadClassification {
  if (score >= 70) return "HOT";
  if (score >= 40) return "WARM";
  return "COLD";
}

/* -------------------------------------------------------------------------
 * Insufficient-data gate for prospects. An Account always qualifies — it
 * exists because a real sale happened.
 * ---------------------------------------------------------------------- */

export function getMissingProspectFields(prospect: { industryId: string | null; stateId: string | null; cityId: string | null }): string[] {
  const missing: string[] = [];
  if (!prospect.industryId) missing.push("industryId");
  if (!prospect.stateId && !prospect.cityId) missing.push("stateId or cityId");
  return missing;
}

/* -------------------------------------------------------------------------
 * Rule-based fallback — fixed weighted formula over inputFeatures. Used
 * when the AI call fails (after one retry) or returns invalid JSON. Always
 * transparent and labeled, never presented as an AI insight.
 * ---------------------------------------------------------------------- */

const RULE_BASED_RECENCY_MAX_DAYS = 180;
const RULE_BASED_ORDER_COUNT_CAP = 10;
const RULE_BASED_ORDER_VALUE_CAP = 500_000;

export function computeRuleBasedScore(features: LeadInputFeatures): number {
  let recencyComponent = 10; // neutral default when there's no order history at all (a prospect)
  if (features.recencyDays !== null) {
    const clampedDays = Math.min(features.recencyDays, RULE_BASED_RECENCY_MAX_DAYS);
    recencyComponent = Math.round(30 * (1 - clampedDays / RULE_BASED_RECENCY_MAX_DAYS));
  }

  const orderCountComponent = Math.round((Math.min(features.orderCount, RULE_BASED_ORDER_COUNT_CAP) / RULE_BASED_ORDER_COUNT_CAP) * 20);
  const orderValueComponent = Math.round((Math.min(features.totalOrderValue, RULE_BASED_ORDER_VALUE_CAP) / RULE_BASED_ORDER_VALUE_CAP) * 10);
  const productFitComponent = Math.round(features.productFitScore * 25);

  const stateComponentByAlignment: Record<StateAlignment, number> = {
    operating: 15,
    target: 10,
    unknown: 5,
    none: 0,
  };
  const stateComponent = stateComponentByAlignment[features.stateAlignment];

  const total = recencyComponent + orderCountComponent + orderValueComponent + productFitComponent + stateComponent;
  return Math.max(0, Math.min(100, total));
}

export function buildRuleBasedReasons(features: LeadInputFeatures): LeadScoreReason[] {
  return [
    {
      factor: "Order recency",
      signal: features.recencyDays !== null && features.recencyDays <= 60 ? "positive" : features.recencyDays === null ? "neutral" : "negative",
      detail:
        features.recencyDays !== null
          ? `Rule-based estimate: most recent order was ${features.recencyDays} day(s) ago.`
          : "Rule-based estimate: no order history is available for this lead yet.",
    },
    {
      factor: "Order volume",
      signal: features.orderCount > 0 ? "positive" : "neutral",
      detail: `Rule-based estimate: ${features.orderCount} order(s) totaling ${features.totalOrderValue}.`,
    },
    {
      factor: "Product fit",
      signal: features.productFitScore > 0 ? "positive" : "neutral",
      detail: `Rule-based estimate: product fit score of ${features.productFitScore} (fraction of active products matching this lead's industry/business type).`,
    },
    {
      factor: "Geographic alignment",
      signal: features.stateAlignment === "operating" ? "positive" : features.stateAlignment === "none" ? "negative" : "neutral",
      detail: `Rule-based estimate: geographic alignment with company operating/target states classified as "${features.stateAlignment}".`,
    },
  ];
}

export function buildRuleBasedRecommendedAction(): LeadScoreRecommendedAction {
  return {
    action: "Manual review recommended",
    rationale: "Rule-based estimate: no valid AI response was available, so this score was computed via a fixed weighted formula over real input features rather than an AI narrative.",
  };
}

/* -------------------------------------------------------------------------
 * AI call + validation + retry + fallback pipeline.
 * ---------------------------------------------------------------------- */

export interface ScoringPipelineResult {
  score: number;
  classification: LeadClassification;
  method: ScoreMethod;
  reasons: LeadScoreReason[];
  recommendedAction: LeadScoreRecommendedAction;
  provider: string;
  modelName: string | null;
  promptVersion: string;
}

const AI_SCORING_MAX_TOKENS = 600;

async function callAIOnce(
  aiProvider: AIProvider,
  promptInput: LeadScoringPromptInput,
): Promise<{ score: number; reasons: LeadScoreReason[]; recommendedAction: LeadScoreRecommendedAction; modelName: string | null } | null> {
  try {
    const prompt = buildLeadScoringPrompt(promptInput);
    const completion = await aiProvider.generateCompletion(prompt, { maxTokens: AI_SCORING_MAX_TOKENS, temperature: 0.3 });
    const parsed = parseAIScoreResponse(completion.content);
    if (!parsed) return null;
    return {
      score: parsed.score,
      reasons: parsed.reasons,
      recommendedAction: parsed.recommendedAction,
      modelName: null,
    };
  } catch {
    return null;
  }
}

/**
 * Calls the AI provider for a score, validating its JSON output. Retries
 * once on failure/invalid output, then falls back to the transparent
 * rule-based formula. Classification is always computed in code from the
 * final numeric score, regardless of method.
 */
export async function runScoringPipeline(
  aiProvider: AIProvider,
  promptInput: LeadScoringPromptInput,
  features: LeadInputFeatures,
): Promise<ScoringPipelineResult> {
  let aiResult = await callAIOnce(aiProvider, promptInput);
  if (!aiResult) {
    aiResult = await callAIOnce(aiProvider, promptInput); // one retry
  }

  if (aiResult) {
    return {
      score: aiResult.score,
      classification: classifyScore(aiResult.score),
      method: "AI",
      reasons: aiResult.reasons,
      recommendedAction: aiResult.recommendedAction,
      provider: aiProvider.name,
      modelName: aiResult.modelName,
      promptVersion: LEAD_SCORING_PROMPT_VERSION,
    };
  }

  const ruleScore = computeRuleBasedScore(features);
  return {
    score: ruleScore,
    classification: classifyScore(ruleScore),
    method: "RULE_BASED",
    reasons: buildRuleBasedReasons(features),
    recommendedAction: buildRuleBasedRecommendedAction(),
    provider: aiProvider.name,
    modelName: null,
    promptVersion: LEAD_SCORING_PROMPT_VERSION,
  };
}

/* -------------------------------------------------------------------------
 * Narrow, injectable Prisma-like dependency interface (mirrors
 * DashboardPrismaDeps) so the orchestration below is unit-testable without a
 * live DB.
 * ---------------------------------------------------------------------- */

export interface ScoringPrismaDeps {
  account: {
    findFirst(args: any): Promise<any | null>;
  };
  prospect: {
    findFirst(args: any): Promise<any | null>;
  };
  salesRecord: {
    findMany(args: any): Promise<any[]>;
  };
  product: {
    findMany(args: any): Promise<any[]>;
  };
  companyOperatingState: {
    findMany(args: any): Promise<any[]>;
  };
  companyTargetState: {
    findMany(args: any): Promise<any[]>;
  };
  leadScore: {
    findFirst(args: any): Promise<any | null>;
  };
}

export interface ScoreLeadParams {
  companyId: string;
  leadId: string;
  force: boolean;
  isPrivilegedCaller: boolean; // ADMIN or MANAGER — allowed to bypass cooldown with force=true
  cooldownHours: number;
  now?: Date;
}

export type ComputeScoreOutcome =
  | { status: "insufficient_data"; missing: string[] }
  | { status: "not_found" }
  | { status: "cooldown"; latestScore: any }
  | {
      status: "ready_to_persist";
      pipelineResult: ScoringPipelineResult;
      inputFeatures: LeadInputFeatures;
    };

async function loadCompanyContext(deps: ScoringPrismaDeps, companyId: string) {
  const [products, operatingStates, targetStates] = await Promise.all([
    deps.product.findMany({
      where: { companyId, isActive: true },
      include: { targetIndustries: true, targetBusinessTypes: true },
    }),
    deps.companyOperatingState.findMany({ where: { companyId } }),
    deps.companyTargetState.findMany({ where: { companyId } }),
  ]);

  const companyProducts = (products as any[]).map((p) => ({
    targetIndustryIds: (p.targetIndustries ?? []).map((t: any) => t.industryId as string),
    targetBusinessTypeIds: (p.targetBusinessTypes ?? []).map((t: any) => t.businessTypeId as string),
  }));
  const operatingStateIds = (operatingStates as any[]).map((s) => s.stateId as string);
  const targetStateIds = (targetStates as any[]).map((s) => s.stateId as string);

  return { companyProducts, operatingStateIds, targetStateIds };
}

function isWithinCooldown(latestScore: { createdAt: Date } | null, cooldownHours: number, now: Date): boolean {
  if (!latestScore) return false;
  const elapsedMs = now.getTime() - new Date(latestScore.createdAt).getTime();
  return elapsedMs < cooldownHours * 60 * 60 * 1000;
}

/**
 * Orchestrates scoring an Account: an Account always qualifies (it exists
 * because of a real sale). Applies the cooldown check, computes real input
 * features from its sales history, and runs the AI/fallback pipeline.
 * Returns a descriptor for the caller to persist — this function never
 * writes to the database itself, so it stays fully unit-testable with fake
 * deps and a fake AIProvider.
 */
export async function scoreAccount(deps: ScoringPrismaDeps, aiProvider: AIProvider, params: ScoreLeadParams): Promise<ComputeScoreOutcome> {
  const now = params.now ?? new Date();
  const account = await deps.account.findFirst({
    where: { id: params.leadId, companyId: params.companyId },
    include: { industry: true, state: true, city: true },
  });
  if (!account) return { status: "not_found" };

  const latestScore = await deps.leadScore.findFirst({
    where: { companyId: params.companyId, accountId: account.id, isLatest: true },
    orderBy: { createdAt: "desc" },
  });

  const bypassCooldown = params.force && params.isPrivilegedCaller;
  if (!bypassCooldown && isWithinCooldown(latestScore, params.cooldownHours, now)) {
    return { status: "cooldown", latestScore };
  }

  const [salesRecords, companyContext] = await Promise.all([
    deps.salesRecord.findMany({ where: { accountId: account.id, companyId: params.companyId, cancelledAt: null } }),
    loadCompanyContext(deps, params.companyId),
  ]);

  const orders: RawOrder[] = (salesRecords as any[]).map((r) => ({ date: new Date(r.date), orderValue: Number(r.orderValue) }));

  const inputFeatures = computeInputFeatures({
    now,
    industryId: account.industryId ?? null,
    businessTypeId: null,
    stateId: account.stateId ?? null,
    orders,
    companyProducts: companyContext.companyProducts,
    operatingStateIds: companyContext.operatingStateIds,
    targetStateIds: companyContext.targetStateIds,
  });

  const pipelineResult = await runScoringPipeline(
    aiProvider,
    {
      leadKind: "existing customer",
      businessName: account.name,
      industryName: account.industry?.name ?? null,
      businessTypeName: null,
      stateName: account.state?.name ?? null,
      cityName: account.city?.name ?? null,
      inputFeatures,
    },
    inputFeatures,
  );

  return { status: "ready_to_persist", pipelineResult, inputFeatures };
}

/**
 * Orchestrates scoring a Prospect: applies the insufficient-data gate first: applies the insufficient-data gate first
 * (never a guessed score), then the same cooldown + feature + pipeline flow
 * as `scoreAccount`.
 */
export async function scoreProspect(deps: ScoringPrismaDeps, aiProvider: AIProvider, params: ScoreLeadParams): Promise<ComputeScoreOutcome> {
  const now = params.now ?? new Date();
  const prospect = await deps.prospect.findFirst({
    where: { id: params.leadId, companyId: params.companyId },
    include: { industry: true, businessType: true, state: true, city: true },
  });
  if (!prospect) return { status: "not_found" };

  const missing = getMissingProspectFields({
    industryId: prospect.industryId ?? null,
    stateId: prospect.stateId ?? null,
    cityId: prospect.cityId ?? null,
  });
  if (missing.length > 0) {
    return { status: "insufficient_data", missing };
  }

  const latestScore = await deps.leadScore.findFirst({
    where: { companyId: params.companyId, prospectId: prospect.id, isLatest: true },
    orderBy: { createdAt: "desc" },
  });

  const bypassCooldown = params.force && params.isPrivilegedCaller;
  if (!bypassCooldown && isWithinCooldown(latestScore, params.cooldownHours, now)) {
    return { status: "cooldown", latestScore };
  }

  const companyContext = await loadCompanyContext(deps, params.companyId);

  const inputFeatures = computeInputFeatures({
    now,
    industryId: prospect.industryId ?? null,
    businessTypeId: prospect.businessTypeId ?? null,
    stateId: prospect.stateId ?? null,
    orders: [],
    companyProducts: companyContext.companyProducts,
    operatingStateIds: companyContext.operatingStateIds,
    targetStateIds: companyContext.targetStateIds,
  });

  const pipelineResult = await runScoringPipeline(
    aiProvider,
    {
      leadKind: "prospect",
      businessName: prospect.businessName,
      industryName: prospect.industry?.name ?? null,
      businessTypeName: prospect.businessType?.name ?? null,
      stateName: prospect.state?.name ?? null,
      cityName: prospect.city?.name ?? null,
      inputFeatures,
    },
    inputFeatures,
  );

  return { status: "ready_to_persist", pipelineResult, inputFeatures };
}

/* -------------------------------------------------------------------------
 * Persistence — writes the new LeadScore row and flips prior rows for that
 * lead to isLatest: false in the same transaction (history preserved). Not
 * abstracted behind an injectable interface (unlike the read/compute path
 * above) since it's a thin, directly-typed wrapper around a real
 * PrismaClient transaction, matching how other modules (e.g.
 * products.service.ts) use `prisma.$transaction` directly. The
 * accountId/prospectId XOR invariant is enforced here before any DB call.
 * ---------------------------------------------------------------------- */

export interface PersistLeadScoreParams {
  companyId: string;
  accountId?: string | null;
  prospectId?: string | null;
  createdById: string | null;
  pipelineResult: ScoringPipelineResult;
  inputFeatures: LeadInputFeatures;
}

export async function persistLeadScore(prisma: PrismaClient, params: PersistLeadScoreParams): Promise<any> {
  const hasAccount = Boolean(params.accountId);
  const hasProspect = Boolean(params.prospectId);
  if (hasAccount === hasProspect) {
    throw new Error("persistLeadScore requires exactly one of accountId or prospectId to be set (XOR invariant)");
  }

  return prisma.$transaction(async (tx) => {
    await tx.leadScore.updateMany({
      where: {
        companyId: params.companyId,
        isLatest: true,
        ...(hasAccount ? { accountId: params.accountId } : { prospectId: params.prospectId }),
      },
      data: { isLatest: false },
    });

    return tx.leadScore.create({
      data: {
        companyId: params.companyId,
        accountId: params.accountId ?? null,
        prospectId: params.prospectId ?? null,
        score: params.pipelineResult.score,
        classification: params.pipelineResult.classification,
        method: params.pipelineResult.method,
        reasons: params.pipelineResult.reasons as unknown as object,
        recommendedAction: params.pipelineResult.recommendedAction as unknown as object,
        inputFeatures: params.inputFeatures as unknown as object,
        provider: params.pipelineResult.provider,
        modelName: params.pipelineResult.modelName,
        promptVersion: params.pipelineResult.promptVersion,
        isLatest: true,
        createdById: params.createdById,
      },
    });
  });
}
