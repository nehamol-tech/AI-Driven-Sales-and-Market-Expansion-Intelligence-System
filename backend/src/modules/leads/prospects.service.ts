import type { Prisma, PrismaClient } from "@prisma/client";
import type { LeadScoreDTO, LeadScoreResult, ProspectDTO } from "@ai-sales/shared";
import { NotFoundError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import { toLeadScoreDTO, toProspectDTO } from "./leads.dto.js";
import * as scoringService from "./scoring.service.js";
import type { CreateProspectInput, ListProspectsQuery, UpdateProspectInput } from "./prospects.schema.js";

const prospectInclude = {
  industry: { select: { name: true } },
  businessType: { select: { name: true } },
  state: { select: { name: true } },
  city: { select: { name: true } },
  assignedUser: { select: { name: true } },
  productsOfInterest: { select: { productId: true } },
} satisfies Prisma.ProspectInclude;

export interface PaginatedProspects {
  items: ProspectDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listProspects(prisma: PrismaClient, companyId: string, query: ListProspectsQuery): Promise<PaginatedProspects> {
  let scoresFilter: Prisma.ProspectWhereInput["scores"] | undefined;
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

  const where: Prisma.ProspectWhereInput = {
    companyId,
    ...(query.search ? { businessName: { contains: query.search, mode: "insensitive" } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
    ...(scoresFilter ? { scores: scoresFilter } : {}),
  };

  const [prospects, total] = await Promise.all([
    prisma.prospect.findMany({
      where,
      include: prospectInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.prospect.count({ where }),
  ]);

  const prospectIds = prospects.map((p) => p.id);
  const latestScores =
    prospectIds.length > 0
      ? await prisma.leadScore.findMany({ where: { companyId, prospectId: { in: prospectIds }, isLatest: true } })
      : [];
  const scoreByProspect = new Map(latestScores.map((s) => [s.prospectId as string, s]));

  const items = prospects.map((p) => toProspectDTO(p, scoreByProspect.get(p.id) ?? null));

  return { items, total, page: query.page, pageSize: query.pageSize };
}

export interface ProspectDetail {
  prospect: ProspectDTO;
  scoreHistory: LeadScoreDTO[];
}

export async function getProspectById(prisma: PrismaClient, companyId: string, id: string): Promise<ProspectDetail> {
  const prospect = await prisma.prospect.findFirst({ where: { id, companyId }, include: prospectInclude });
  if (!prospect) {
    throw new NotFoundError("Prospect not found");
  }
  const scores = await prisma.leadScore.findMany({ where: { companyId, prospectId: id }, orderBy: { createdAt: "desc" } });
  const latestScore = scores.find((s) => s.isLatest) ?? null;
  const prospectDTO = toProspectDTO(prospect, latestScore);
  return { prospect: prospectDTO, scoreHistory: scores.map(toLeadScoreDTO) };
}

export async function createProspect(
  prisma: PrismaClient,
  companyId: string,
  createdById: string | null,
  input: CreateProspectInput,
): Promise<ProspectDTO> {
  const prospect = await prisma.prospect.create({
    data: {
      companyId,
      businessName: input.businessName,
      industryId: input.industryId ?? null,
      businessTypeId: input.businessTypeId ?? null,
      stateId: input.stateId ?? null,
      cityId: input.cityId ?? null,
      website: input.website ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      status: input.status,
      source: "MANUAL",
      assignedUserId: input.assignedUserId ?? null,
      createdById,
      campaignId: input.campaignId ?? null,
      productsOfInterest: { create: input.productIds.map((productId) => ({ productId })) },
    },
    include: prospectInclude,
  });
  return toProspectDTO(prospect, null);
}

export async function updateProspect(
  prisma: PrismaClient,
  companyId: string,
  id: string,
  input: UpdateProspectInput,
): Promise<ProspectDTO> {
  const existing = await prisma.prospect.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Prospect not found");
  }

  const prospect = await prisma.$transaction(async (tx) => {
    if (input.productIds !== undefined) {
      await tx.prospectProductInterest.deleteMany({ where: { prospectId: id } });
      if (input.productIds.length > 0) {
        await tx.prospectProductInterest.createMany({ data: input.productIds.map((productId) => ({ prospectId: id, productId })) });
      }
    }

    return tx.prospect.update({
      where: { id },
      data: {
        ...(input.businessName !== undefined ? { businessName: input.businessName } : {}),
        ...(input.industryId !== undefined ? { industryId: input.industryId } : {}),
        ...(input.businessTypeId !== undefined ? { businessTypeId: input.businessTypeId } : {}),
        ...(input.stateId !== undefined ? { stateId: input.stateId } : {}),
        ...(input.cityId !== undefined ? { cityId: input.cityId } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
        ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
      },
      include: prospectInclude,
    });
  });

  const latestScore = await prisma.leadScore.findFirst({ where: { companyId, prospectId: id, isLatest: true } });
  return toProspectDTO(prospect, latestScore);
}

export async function deleteProspect(prisma: PrismaClient, companyId: string, id: string): Promise<void> {
  const existing = await prisma.prospect.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Prospect not found");
  }
  await prisma.prospect.delete({ where: { id } });
}

export interface TriggerProspectScoreOptions {
  userId: string;
  isPrivilegedCaller: boolean;
  force: boolean;
  cooldownHours: number;
  ipAddress: string | null;
}

/**
 * Triggers (re)scoring of a Prospect. Applies the insufficient-data gate
 * before ever calling AI — a Prospect without industryId + (stateId or
 * cityId) always resolves to insufficient_data, never a guessed score.
 */
export async function triggerProspectScore(
  prisma: PrismaClient,
  companyId: string,
  prospectId: string,
  opts: TriggerProspectScoreOptions,
): Promise<LeadScoreResult> {
  const aiProvider = createAIProvider();
  const outcome = await scoringService.scoreProspect(prisma, aiProvider, {
    companyId,
    leadId: prospectId,
    force: opts.force,
    isPrivilegedCaller: opts.isPrivilegedCaller,
    cooldownHours: opts.cooldownHours,
  });

  if (outcome.status === "not_found") {
    throw new NotFoundError("Prospect not found");
  }
  if (outcome.status === "insufficient_data") {
    return { status: "insufficient_data", missing: outcome.missing };
  }
  if (outcome.status === "cooldown") {
    return { status: "ok", score: toLeadScoreDTO(outcome.latestScore) };
  }

  const created = await scoringService.persistLeadScore(prisma, {
    companyId,
    prospectId,
    createdById: opts.userId,
    pipelineResult: outcome.pipelineResult,
    inputFeatures: outcome.inputFeatures,
  });

  await logAudit(
    {
      userId: opts.userId,
      action: "LEAD_SCORE_COMPUTED",
      entityType: "Prospect",
      entityId: prospectId,
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
