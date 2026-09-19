import type { Prisma, PrismaClient } from "@prisma/client";
import type { AdCampaignDTO, AdSpendRecordDTO } from "@ai-sales/shared";
import { NotFoundError } from "../../lib/errors.js";
import { toAdCampaignDTO, toAdSpendRecordDTO } from "./advertising.dto.js";
import type { CreateCampaignInput, CreateSpendRecordInput, ListCampaignsQuery, UpdateCampaignInput } from "./ad-campaigns.schema.js";

export interface PaginatedCampaigns {
  items: AdCampaignDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listCampaigns(prisma: PrismaClient, companyId: string, query: ListCampaignsQuery): Promise<PaginatedCampaigns> {
  const where: Prisma.AdCampaignWhereInput = {
    companyId,
    ...(query.platform ? { platform: query.platform } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.adCampaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.adCampaign.count({ where }),
  ]);

  return { items: items.map(toAdCampaignDTO), total, page: query.page, pageSize: query.pageSize };
}

export async function getCampaign(prisma: PrismaClient, companyId: string, id: string): Promise<AdCampaignDTO> {
  const campaign = await prisma.adCampaign.findFirst({ where: { id, companyId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  return toAdCampaignDTO(campaign);
}

/** Any authenticated role may create a campaign — matches Prospect/SalesRecord's creation precedent. Always tagged source: MANUAL on this path (a sync-created campaign is tagged META_SYNC/GOOGLE_SYNC by ad-sync.service.ts instead). */
export async function createCampaign(prisma: PrismaClient, companyId: string, createdById: string | null, input: CreateCampaignInput): Promise<AdCampaignDTO> {
  const campaign = await prisma.adCampaign.create({
    data: {
      companyId,
      platform: input.platform,
      source: "MANUAL",
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      isActive: input.isActive,
      createdById,
    },
  });
  return toAdCampaignDTO(campaign);
}

export async function updateCampaign(prisma: PrismaClient, companyId: string, id: string, input: UpdateCampaignInput): Promise<AdCampaignDTO> {
  const existing = await prisma.adCampaign.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Campaign not found");
  }

  const campaign = await prisma.adCampaign.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return toAdCampaignDTO(campaign);
}

/**
 * ADMIN/MANAGER only (enforced at the route layer) — matches Prospect/
 * FollowUp's delete precedent exactly. AdSpendRecord.campaignId is a
 * required (RESTRICT) FK, so a campaign's spend records are deleted first,
 * in the same transaction, rather than leaving the delete to fail on the DB
 * constraint. Prospect.campaignId is a nullable SET NULL FK, so any
 * prospect attributed to this campaign is automatically un-attributed
 * (never deleted) by the DB itself.
 */
export async function deleteCampaign(prisma: PrismaClient, companyId: string, id: string): Promise<void> {
  const existing = await prisma.adCampaign.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Campaign not found");
  }
  await prisma.$transaction([prisma.adSpendRecord.deleteMany({ where: { campaignId: id } }), prisma.adCampaign.delete({ where: { id } })]);
}

export async function listSpendRecords(prisma: PrismaClient, companyId: string, campaignId: string): Promise<AdSpendRecordDTO[]> {
  const campaign = await prisma.adCampaign.findFirst({ where: { id: campaignId, companyId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  const records = await prisma.adSpendRecord.findMany({ where: { campaignId }, orderBy: { date: "desc" } });
  return records.map(toAdSpendRecordDTO);
}

/** Always tagged source: MANUAL — a synced spend record is written directly by ad-sync.service.ts instead. */
export async function createSpendRecord(prisma: PrismaClient, companyId: string, campaignId: string, input: CreateSpendRecordInput): Promise<AdSpendRecordDTO> {
  const campaign = await prisma.adCampaign.findFirst({ where: { id: campaignId, companyId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  const record = await prisma.adSpendRecord.create({
    data: {
      campaignId,
      date: input.date,
      amount: input.amount,
      impressions: input.impressions ?? null,
      clicks: input.clicks ?? null,
      source: "MANUAL",
    },
  });
  return toAdSpendRecordDTO(record);
}

export async function deleteSpendRecord(prisma: PrismaClient, companyId: string, campaignId: string, spendId: string): Promise<void> {
  const campaign = await prisma.adCampaign.findFirst({ where: { id: campaignId, companyId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  const existing = await prisma.adSpendRecord.findFirst({ where: { id: spendId, campaignId } });
  if (!existing) {
    throw new NotFoundError("Spend record not found");
  }
  await prisma.adSpendRecord.delete({ where: { id: spendId } });
}
