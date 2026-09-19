import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { logAudit } from "../audit/audit.service.js";
import * as adCampaignsService from "./ad-campaigns.service.js";
import type { CreateCampaignInput, CreateSpendRecordInput, ListCampaignsQuery, UpdateCampaignInput } from "./ad-campaigns.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function listCampaigns(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const query = req.query as unknown as ListCampaignsQuery;
  const result = await adCampaignsService.listCampaigns(prisma, companyId, query);
  res.status(200).json({ data: result.items, pagination: { page: result.page, pageSize: result.pageSize, total: result.total } });
}

export async function getCampaign(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const campaign = await adCampaignsService.getCampaign(prisma, companyId, req.params.id);
  res.status(200).json(campaign);
}

export async function createCampaign(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as CreateCampaignInput;
  const campaign = await adCampaignsService.createCampaign(prisma, user.companyId, user.id, input);
  await logAudit({
    userId: user.id,
    action: "AD_CAMPAIGN_CREATE",
    entityType: "AdCampaign",
    entityId: campaign.id,
    metadata: { name: campaign.name, platform: campaign.platform },
    ipAddress: req.ip ?? null,
  });
  res.status(201).json(campaign);
}

export async function updateCampaign(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as UpdateCampaignInput;
  const campaign = await adCampaignsService.updateCampaign(prisma, user.companyId, req.params.id, input);
  await logAudit({
    userId: user.id,
    action: "AD_CAMPAIGN_UPDATE",
    entityType: "AdCampaign",
    entityId: campaign.id,
    metadata: input,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(campaign);
}

export async function deleteCampaign(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await adCampaignsService.deleteCampaign(prisma, user.companyId, req.params.id);
  await logAudit({
    userId: user.id,
    action: "AD_CAMPAIGN_DELETE",
    entityType: "AdCampaign",
    entityId: req.params.id,
    ipAddress: req.ip ?? null,
  });
  res.status(204).send();
}

export async function listSpendRecords(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const records = await adCampaignsService.listSpendRecords(prisma, companyId, req.params.id);
  res.status(200).json({ data: records });
}

export async function createSpendRecord(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as CreateSpendRecordInput;
  const record = await adCampaignsService.createSpendRecord(prisma, user.companyId, req.params.id, input);
  await logAudit({
    userId: user.id,
    action: "AD_SPEND_RECORD_CREATE",
    entityType: "AdSpendRecord",
    entityId: record.id,
    metadata: { campaignId: req.params.id, amount: record.amount },
    ipAddress: req.ip ?? null,
  });
  res.status(201).json(record);
}

export async function deleteSpendRecord(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await adCampaignsService.deleteSpendRecord(prisma, user.companyId, req.params.id, req.params.spendId);
  await logAudit({
    userId: user.id,
    action: "AD_SPEND_RECORD_DELETE",
    entityType: "AdSpendRecord",
    entityId: req.params.spendId,
    ipAddress: req.ip ?? null,
  });
  res.status(204).send();
}
