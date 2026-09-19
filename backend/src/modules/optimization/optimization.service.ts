/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient, Role } from "@prisma/client";
import type {
  GenerateRecommendationsResultDTO,
  OptimizationExecutionResult,
  OptimizationRecommendationDTO,
  OptimizationRecommendationType,
  PaginatedOptimizationRecommendationsDTO,
  ScoreMethod,
} from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import { NotFoundError, ConflictError, ForbiddenError } from "../../lib/errors.js";
import { DEFAULT_PAGE_SIZE } from "../../config/constants.js";
import { logAudit } from "../audit/audit.service.js";
import { gatherAccountProfiles, type OpportunitiesPrismaDeps } from "../opportunities/account-profile.service.js";
import { detectAtRisk, type OpportunityCandidate } from "../opportunities/detectors.js";
import { computeCampaignAnalytics, type AdvertisingAnalyticsPrismaDeps } from "../advertising/advertising-analytics.service.js";
import { updateCampaign } from "../advertising/ad-campaigns.service.js";
import { computeExpansionRecommendations, type DistributorExpansionPrismaDeps } from "../distributors/distributor-expansion.service.js";
import { createFollowUp } from "../follow-ups/follow-ups.service.js";
import {
  buildDistributorAdvisoryCandidates,
  detectFollowUpCandidates,
  detectUnderperformingCampaigns,
  UNDERPERFORMING_ROAS_THRESHOLD,
  type FollowUpCandidateInput,
  type OptimizationCandidate,
} from "./optimization-detection.js";
import { buildOptimizationPrompt, type OptimizationNarrationCandidate } from "./optimization.prompt.js";
import { parseAIOptimizationResponse } from "./optimization.schema.js";
import type { ListOptimizationQuery } from "./optimization.schema.js";
import { toOptimizationRecommendationDTO } from "./optimization.dto.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many days out an AT_RISK-triggered follow-up should be due — sooner than a plain SCHEDULE_FOLLOW_UP nudge, since a real documented decline is a stronger signal. */
const AT_RISK_FOLLOW_UP_DUE_IN_DAYS = 2;

/* -------------------------------------------------------------------------
 * Narrow, injectable Prisma-like dependency interface — a superset of
 * OpportunitiesPrismaDeps (gatherAccountProfiles), AdvertisingAnalyticsPrismaDeps
 * (computeCampaignAnalytics), and DistributorExpansionPrismaDeps
 * (computeExpansionRecommendations), plus this feature's own
 * optimizationRecommendation/followUp needs. A real PrismaClient satisfies
 * this structurally — no adapter needed. Uses an intersection type (not
 * `interface ... extends`) because the merged base interfaces define
 * different, non-overlapping method sets on the same delegate names (e.g.
 * `account.findMany` vs `account.findUnique`) — an intersection lets a
 * conforming object simply implement the union of both.
 * ---------------------------------------------------------------------- */
export type OptimizationPrismaDeps = OpportunitiesPrismaDeps &
  AdvertisingAnalyticsPrismaDeps &
  DistributorExpansionPrismaDeps & {
    followUp: {
      findMany(args: any): Promise<any[]>;
    };
    optimizationRecommendation: {
      findMany(args: any): Promise<any[]>;
      findFirst(args: any): Promise<any | null>;
      count(args: any): Promise<number>;
      create(args: any): Promise<any>;
      update(args: any): Promise<any>;
    };
  };

/* =========================================================================
 * Candidate gathering — each function deterministically cross-references
 * real signals already computed by an earlier phase (reused, never
 * reimplemented) and returns real OptimizationCandidate objects. No AI is
 * involved anywhere in this section.
 * ========================================================================= */

/**
 * SCHEDULE_FOLLOW_UP — every real HOT/WARM-classified lead (Phase 2's own
 * `isLatest` classification, the exact query pattern already established in
 * sales-agent.service.ts/account-profile.service.ts) that currently has zero
 * PENDING follow-ups on file. The pending-follow-up check is one batched
 * query (never N+1).
 */
async function gatherFollowUpCandidates(deps: OptimizationPrismaDeps, companyId: string, now: Date): Promise<OptimizationCandidate[]> {
  const scores = await deps.leadScore.findMany({
    where: { companyId, isLatest: true, classification: { in: ["HOT", "WARM"] } },
    include: { account: { select: { id: true, name: true } }, prospect: { select: { id: true, businessName: true } } },
  });

  const leads: FollowUpCandidateInput[] = (scores as any[])
    .map((s): FollowUpCandidateInput | null => {
      if (s.accountId) {
        return { leadId: s.accountId as string, leadType: "accounts", leadName: (s.account?.name as string) ?? "", classification: s.classification };
      }
      if (s.prospectId) {
        return { leadId: s.prospectId as string, leadType: "prospects", leadName: (s.prospect?.businessName as string) ?? "", classification: s.classification };
      }
      return null;
    })
    .filter((l): l is FollowUpCandidateInput => l !== null);

  if (leads.length === 0) return [];

  const accountIds = leads.filter((l) => l.leadType === "accounts").map((l) => l.leadId);
  const prospectIds = leads.filter((l) => l.leadType === "prospects").map((l) => l.leadId);

  const orClauses: Record<string, unknown>[] = [];
  if (accountIds.length > 0) orClauses.push({ accountId: { in: accountIds } });
  if (prospectIds.length > 0) orClauses.push({ prospectId: { in: prospectIds } });

  const pending = await deps.followUp.findMany({
    where: { companyId, status: "PENDING", OR: orClauses },
    select: { accountId: true, prospectId: true },
  });

  const pendingSet = new Set<string>();
  for (const p of pending as { accountId: string | null; prospectId: string | null }[]) {
    if (p.accountId) pendingSet.add(p.accountId);
    if (p.prospectId) pendingSet.add(p.prospectId);
  }

  return detectFollowUpCandidates(leads, pendingSet, now);
}

function evidenceArrayToRecord(items: { label: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(items.map((e) => [e.label, e.value]));
}

/**
 * AT_RISK_FOLLOW_UP — built directly here (not in optimization-detection.ts)
 * since it needs the real AccountProfile[] from gatherAccountProfiles and
 * calls detectAtRisk (Phase 3C, reused verbatim, never reimplemented)
 * itself. Filtered to accounts with zero PENDING follow-ups, exactly like
 * gatherFollowUpCandidates above.
 */
async function gatherAtRiskCandidates(deps: OptimizationPrismaDeps, companyId: string, now: Date): Promise<OptimizationCandidate[]> {
  const { profiles } = await gatherAccountProfiles(deps, companyId, now);

  const atRiskByAccount = new Map<string, OpportunityCandidate>();
  for (const profile of profiles) {
    const atRisk = detectAtRisk(profile, now);
    if (atRisk) atRiskByAccount.set(profile.id, atRisk);
  }
  if (atRiskByAccount.size === 0) return [];

  const accountIds = Array.from(atRiskByAccount.keys());
  const pending = await deps.followUp.findMany({
    where: { companyId, status: "PENDING", accountId: { in: accountIds } },
    select: { accountId: true },
  });
  const pendingSet = new Set((pending as { accountId: string | null }[]).map((p) => p.accountId).filter((v): v is string => v !== null));

  const dueDate = new Date(now.getTime() + AT_RISK_FOLLOW_UP_DUE_IN_DAYS * MS_PER_DAY).toISOString();

  const candidates: OptimizationCandidate[] = [];
  for (const [accountId, atRisk] of atRiskByAccount) {
    if (pendingSet.has(accountId)) continue;
    candidates.push({
      type: "AT_RISK_FOLLOW_UP",
      targetType: "ACCOUNT",
      targetId: accountId,
      targetLabel: atRisk.name,
      actionType: "CREATE_FOLLOW_UP",
      actionParams: { leadId: accountId, leadType: "accounts", dueDate, notes: null },
      // Real evidence straight from detectAtRisk's own already-computed OpportunityCandidate — never re-derived.
      evidence: { ...evidenceArrayToRecord(atRisk.evidence), declinePct: Math.round(atRisk.rankSignal * 100) },
    });
  }
  return candidates;
}

/**
 * PAUSE_UNDERPERFORMING_CAMPAIGN — every real active AdCampaign whose real,
 * already-computed ROAS (Phase 7's computeCampaignAnalytics, reused
 * verbatim) is a known number below UNDERPERFORMING_ROAS_THRESHOLD.
 * `insufficient_data` campaigns are never flagged.
 */
async function gatherUnderperformingCampaignCandidates(deps: OptimizationPrismaDeps, companyId: string): Promise<OptimizationCandidate[]> {
  const activeCampaigns = await deps.adCampaign.findMany({ where: { companyId, isActive: true } });
  if ((activeCampaigns as any[]).length === 0) return [];

  const analytics = await Promise.all(
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

  const underperforming = detectUnderperformingCampaigns(analytics);

  return underperforming.map((c) => ({
    type: "PAUSE_UNDERPERFORMING_CAMPAIGN",
    targetType: "AD_CAMPAIGN",
    targetId: c.campaignId,
    targetLabel: c.campaignName,
    actionType: "PAUSE_CAMPAIGN",
    actionParams: { campaignId: c.campaignId },
    evidence: {
      roas: c.roas.status === "ok" ? c.roas.value : null,
      totalSpend: c.totalSpend,
      attributedRevenue: c.attributedRevenue.status === "ok" ? c.attributedRevenue.value : null,
    },
  }));
}

/**
 * DISTRIBUTOR_EXPANSION_ADVISORY — the top N of Phase 8's own already-ranked
 * expansion recommendations (computeExpansionRecommendations, reused
 * verbatim). Purely advisory: `actionType: "ADVISORY_ONLY"` has no real
 * mutation behind it (there is no "assign distributor to state" action in
 * this schema) — approving one is just a human acknowledgment.
 */
async function gatherDistributorAdvisoryCandidates(deps: OptimizationPrismaDeps, companyId: string, now: Date): Promise<OptimizationCandidate[]> {
  const recommendations = await computeExpansionRecommendations(deps, companyId, now);
  const top = buildDistributorAdvisoryCandidates(recommendations);

  return top.map((r) => ({
    type: "DISTRIBUTOR_EXPANSION_ADVISORY",
    targetType: "STATE",
    targetId: r.stateId,
    targetLabel: r.stateName,
    actionType: "ADVISORY_ONLY",
    actionParams: {},
    evidence: { opportunityScore: r.opportunityScore, opportunityClassification: r.opportunityClassification },
  }));
}

/* =========================================================================
 * RULE_BASED fallback narratives — always hedged, always built directly
 * from the same real `evidence` the AI would have been given. Never a
 * silent failure.
 * ========================================================================= */

function buildRuleBasedNarrative(type: OptimizationRecommendationType, evidence: Record<string, unknown>): string {
  switch (type) {
    case "SCHEDULE_FOLLOW_UP": {
      const classification = evidence.classification ?? "HOT/WARM";
      return `This ${classification} lead has no pending follow-up scheduled — a follow-up within the next few days is recommended.`;
    }
    case "AT_RISK_FOLLOW_UP": {
      const declinePct = evidence.declinePct ?? "a significant";
      return `This account's order value has declined ${declinePct}% recently compared to the prior period — a follow-up is recommended before the relationship weakens further.`;
    }
    case "PAUSE_UNDERPERFORMING_CAMPAIGN": {
      const roas = evidence.roas ?? "below 1";
      return `This campaign's real return on ad spend is ${roas}x, meaning spend currently exceeds attributed revenue — pausing it is recommended until performance improves.`;
    }
    case "DISTRIBUTOR_EXPANSION_ADVISORY": {
      const classification = String(evidence.opportunityClassification ?? "")
        .replace(/_/g, " ")
        .toLowerCase();
      return `This state shows a real ${classification || "notable"} demand signal with zero distributor coverage today.`;
    }
    default:
      return "This recommendation is based on real, already-computed evidence.";
  }
}

/* =========================================================================
 * AI narrative call + validation + retry + fallback — ONE batched call for
 * the whole newly-persisted set, mirrors opportunities.service.ts's
 * runOpportunityNarrativePipeline exactly.
 * ========================================================================= */

const OPTIMIZATION_AI_MAX_TOKENS = 2000;

async function callOptimizationAIOnce(aiProvider: AIProvider, candidates: OptimizationNarrationCandidate[]): Promise<Map<string, string> | null> {
  try {
    const prompt = buildOptimizationPrompt(candidates);
    const completion = await aiProvider.generateCompletion(prompt, { maxTokens: OPTIMIZATION_AI_MAX_TOKENS, temperature: 0.3 });
    const requestedIds = candidates.map((c) => c.id);
    const parsed = parseAIOptimizationResponse(completion.content, requestedIds);
    if (!parsed) return null;
    return new Map(parsed.map((e) => [e.id, e.narrative]));
  } catch {
    return null;
  }
}

export interface OptimizationNarrativePipelineResult {
  /** Present only when the AI actually narrated (empty when the whole batch fell back). */
  entries: Map<string, string>;
  method: ScoreMethod;
}

export async function runOptimizationNarrativePipeline(
  aiProvider: AIProvider,
  candidates: OptimizationNarrationCandidate[],
): Promise<OptimizationNarrativePipelineResult> {
  if (candidates.length === 0) {
    return { entries: new Map(), method: "RULE_BASED" };
  }

  let result = await callOptimizationAIOnce(aiProvider, candidates);
  if (!result) {
    result = await callOptimizationAIOnce(aiProvider, candidates); // one retry
  }

  if (result) {
    return { entries: result, method: "AI" };
  }

  return { entries: new Map(), method: "RULE_BASED" };
}

/* =========================================================================
 * Generation — detect (all 4 types) -> dedupe against existing PENDING rows
 * -> persist -> narrate (one batched AI call) -> finalize.
 * ========================================================================= */

async function persistCandidates(deps: OptimizationPrismaDeps, companyId: string, candidates: OptimizationCandidate[]): Promise<any[]> {
  return Promise.all(
    candidates.map((c) =>
      deps.optimizationRecommendation.create({
        data: {
          companyId,
          type: c.type,
          status: "PENDING",
          targetType: c.targetType,
          targetId: c.targetId,
          targetLabel: c.targetLabel,
          actionType: c.actionType,
          actionParams: c.actionParams,
          evidence: c.evidence,
          narrative: null,
          narrativeMethod: "RULE_BASED", // placeholder — always overwritten by the narration step below before this row is ever returned
        },
      }),
    ),
  );
}

/**
 * Top-level generation entry point. Gathers all four candidate lists in
 * parallel, deduplicates against existing PENDING rows for this company
 * (same type+targetType+targetId), persists only the genuinely new
 * candidates, then narrates the whole newly-persisted batch with ONE AI
 * call (retried once, RULE_BASED per-candidate fallback on failure). Zero
 * new candidates -> zero AI calls, exactly like every other AI-narration
 * phase in this codebase.
 */
export async function generateRecommendations(
  deps: OptimizationPrismaDeps,
  aiProvider: AIProvider,
  companyId: string,
  now: Date,
): Promise<GenerateRecommendationsResultDTO> {
  const [followUpCandidates, atRiskCandidates, campaignCandidates, distributorCandidates] = await Promise.all([
    gatherFollowUpCandidates(deps, companyId, now),
    gatherAtRiskCandidates(deps, companyId, now),
    gatherUnderperformingCampaignCandidates(deps, companyId),
    gatherDistributorAdvisoryCandidates(deps, companyId, now),
  ]);

  const allCandidates = [...followUpCandidates, ...atRiskCandidates, ...campaignCandidates, ...distributorCandidates];

  const existing = await deps.optimizationRecommendation.findMany({
    where: { companyId, status: "PENDING" },
    select: { type: true, targetType: true, targetId: true },
  });
  const existingKeys = new Set((existing as { type: string; targetType: string; targetId: string }[]).map((e) => `${e.type}:${e.targetType}:${e.targetId}`));

  const newCandidates: OptimizationCandidate[] = [];
  const seenInBatch = new Set<string>();
  let skippedDuplicates = 0;
  for (const c of allCandidates) {
    const key = `${c.type}:${c.targetType}:${c.targetId}`;
    if (existingKeys.has(key) || seenInBatch.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    seenInBatch.add(key);
    newCandidates.push(c);
  }

  if (newCandidates.length === 0) {
    return { created: [], skippedDuplicates };
  }

  const createdRows = await persistCandidates(deps, companyId, newCandidates);

  const narrationInput: OptimizationNarrationCandidate[] = createdRows.map((row) => ({
    id: row.id as string,
    type: row.type as string,
    targetLabel: row.targetLabel as string,
    evidence: row.evidence as Record<string, unknown>,
  }));
  const { entries, method } = await runOptimizationNarrativePipeline(aiProvider, narrationInput);

  const finalRows = await Promise.all(
    createdRows.map((row) => {
      const narrative = method === "AI" ? (entries.get(row.id as string) as string) : buildRuleBasedNarrative(row.type as OptimizationRecommendationType, row.evidence as Record<string, unknown>);
      return deps.optimizationRecommendation.update({
        where: { id: row.id },
        data: { narrative, narrativeMethod: method },
      });
    }),
  );

  return { created: finalRows.map(toOptimizationRecommendationDTO), skippedDuplicates };
}

/* =========================================================================
 * Read paths
 * ========================================================================= */

export async function listRecommendations(
  deps: OptimizationPrismaDeps,
  companyId: string,
  query: ListOptimizationQuery,
): Promise<PaginatedOptimizationRecommendationsDTO> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = {
    companyId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
  };

  const [items, total] = await Promise.all([
    deps.optimizationRecommendation.findMany({
      where,
      include: { reviewedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    deps.optimizationRecommendation.count({ where }),
  ]);

  return { items: (items as any[]).map(toOptimizationRecommendationDTO), total, page, pageSize };
}

export async function getRecommendation(deps: OptimizationPrismaDeps, companyId: string, id: string): Promise<OptimizationRecommendationDTO> {
  const row = await deps.optimizationRecommendation.findFirst({
    where: { id, companyId },
    include: { reviewedBy: { select: { name: true } } },
  });
  if (!row) {
    throw new NotFoundError("Optimization recommendation not found");
  }
  return toOptimizationRecommendationDTO(row);
}

/* =========================================================================
 * Approve / reject — the only paths that ever mutate real business state,
 * and only via an existing, already-tested service function from the phase
 * that owns the entity. Take a real PrismaClient (not the narrow deps
 * above) because createFollowUp/updateCampaign/computeCampaignAnalytics
 * themselves are typed against PrismaClient/their own narrow deps.
 * ========================================================================= */

/**
 * Six-step approval pipeline: (1) validation, (2) deterministic
 * re-validation that the live condition still holds, (3) authorization
 * defense-in-depth, (4) execution via an existing service function, (5)
 * audit, (6) result/status update. A stale condition at step 2 is an
 * expected, handled outcome (EXECUTION_FAILED with a specific real reason)
 * — never thrown as a server error.
 */
export async function approveRecommendation(
  prisma: PrismaClient,
  companyId: string,
  id: string,
  approverUserId: string,
  approverRole: Role,
  now: Date = new Date(),
): Promise<OptimizationRecommendationDTO> {
  // Step 1: Validation
  const existing = await prisma.optimizationRecommendation.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Optimization recommendation not found");
  }
  if (existing.status !== "PENDING") {
    throw new ConflictError("This recommendation has already been reviewed");
  }

  const actionParams = (existing.actionParams ?? {}) as Record<string, unknown>;

  // Step 2: Deterministic re-validation — the live condition must still hold.
  let staleReason: string | null = null;
  if (existing.actionType === "CREATE_FOLLOW_UP") {
    const leadId = actionParams.leadId as string;
    const leadType = actionParams.leadType as "accounts" | "prospects";
    const pendingCount = await prisma.followUp.count({
      where: {
        companyId,
        status: "PENDING",
        ...(leadType === "accounts" ? { accountId: leadId } : { prospectId: leadId }),
      },
    });
    if (pendingCount > 0) {
      staleReason = "This lead already has a pending follow-up";
    }
  } else if (existing.actionType === "PAUSE_CAMPAIGN") {
    const campaignId = actionParams.campaignId as string;
    const campaign = await prisma.adCampaign.findFirst({ where: { id: campaignId, companyId } });
    if (!campaign) {
      staleReason = "This campaign no longer exists";
    } else if (!campaign.isActive) {
      staleReason = "This campaign has already been paused";
    } else {
      const analytics = await computeCampaignAnalytics(prisma, companyId, {
        id: campaign.id,
        name: campaign.name,
        platform: campaign.platform,
        source: campaign.source,
        startDate: campaign.startDate,
      });
      if (!(analytics.roas.status === "ok" && analytics.roas.value < UNDERPERFORMING_ROAS_THRESHOLD)) {
        staleReason = "This campaign's return on ad spend is no longer underperforming";
      }
    }
  }
  // "ADVISORY_ONLY" has no live condition to go stale — nothing to re-check.

  if (staleReason) {
    const executionResult: OptimizationExecutionResult = { success: false, message: staleReason };
    const updated = await prisma.optimizationRecommendation.update({
      where: { id },
      data: {
        status: "EXECUTION_FAILED",
        reviewedByUserId: approverUserId,
        reviewedAt: now,
        executionResult: executionResult as object,
      },
      include: { reviewedBy: { select: { name: true } } },
    });

    // Step 5: Audit — still recorded for a handled, expected failed-approval attempt.
    // Explicitly routed through the same `prisma` client this function was given (rather than
    // logAudit's default global-singleton client) so this function stays fully testable against
    // fake injected deps, and so the audit write shares the same connection/transaction context.
    await logAudit(
      {
        userId: approverUserId,
        action: "OPTIMIZATION_RECOMMENDATION_APPROVED",
        entityType: "OptimizationRecommendation",
        entityId: id,
        metadata: { type: existing.type, actionType: existing.actionType, executionResult },
      },
      prisma,
    );

    return toOptimizationRecommendationDTO(updated);
  }

  // Step 3: Authorization — defense-in-depth (the route already applies requireRole("ADMIN","MANAGER")).
  if (approverRole !== "ADMIN" && approverRole !== "MANAGER") {
    throw new ForbiddenError("Only ADMIN or MANAGER may approve an optimization recommendation");
  }

  // Step 4: Execution — dispatches to an existing, already-tested service function. Never lets a thrown error escape uncaught.
  let executionResult: OptimizationExecutionResult;
  try {
    if (existing.actionType === "CREATE_FOLLOW_UP") {
      const leadId = actionParams.leadId as string;
      const leadType = actionParams.leadType as "accounts" | "prospects";
      const dueDate = new Date(actionParams.dueDate as string);
      const notes = (actionParams.notes as string | null | undefined) ?? undefined;
      const followUp = await createFollowUp(prisma, companyId, approverUserId, approverRole, { leadId, leadType, dueDate, notes });
      executionResult = { success: true, createdEntityId: followUp.id };
    } else if (existing.actionType === "PAUSE_CAMPAIGN") {
      const campaignId = actionParams.campaignId as string;
      await updateCampaign(prisma, companyId, campaignId, { isActive: false });
      executionResult = { success: true, message: "Campaign paused" };
    } else {
      // ADVISORY_ONLY — nothing to execute, just a human acknowledgment.
      executionResult = { success: true, message: "Acknowledged" };
    }
  } catch (err) {
    executionResult = { success: false, message: err instanceof Error ? err.message : "Unknown error" };
  }

  // Step 5: Audit — routed through the same `prisma` client (see the stale-path comment above).
  await logAudit(
    {
      userId: approverUserId,
      action: "OPTIMIZATION_RECOMMENDATION_APPROVED",
      entityType: "OptimizationRecommendation",
      entityId: id,
      metadata: { type: existing.type, actionType: existing.actionType, executionResult },
    },
    prisma,
  );

  // Step 6: Result/status
  const updated = await prisma.optimizationRecommendation.update({
    where: { id },
    data: {
      status: executionResult.success ? "EXECUTED" : "EXECUTION_FAILED",
      reviewedByUserId: approverUserId,
      reviewedAt: now,
      executedAt: executionResult.success ? now : null,
      executionResult: executionResult as object,
    },
    include: { reviewedBy: { select: { name: true } } },
  });

  return toOptimizationRecommendationDTO(updated);
}

export async function rejectRecommendation(prisma: PrismaClient, companyId: string, id: string, reviewerUserId: string, now: Date = new Date()): Promise<OptimizationRecommendationDTO> {
  const existing = await prisma.optimizationRecommendation.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Optimization recommendation not found");
  }
  if (existing.status !== "PENDING") {
    throw new ConflictError("This recommendation has already been reviewed");
  }

  const updated = await prisma.optimizationRecommendation.update({
    where: { id },
    data: { status: "REJECTED", reviewedByUserId: reviewerUserId, reviewedAt: now },
    include: { reviewedBy: { select: { name: true } } },
  });

  await logAudit(
    {
      userId: reviewerUserId,
      action: "OPTIMIZATION_RECOMMENDATION_REJECTED",
      entityType: "OptimizationRecommendation",
      entityId: id,
      metadata: { type: existing.type, actionType: existing.actionType },
    },
    prisma,
  );

  return toOptimizationRecommendationDTO(updated);
}
