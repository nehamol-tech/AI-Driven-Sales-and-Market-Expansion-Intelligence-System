import type { Request, Response } from "express";
import type { OpportunitySummaryDTO, ScoreMethod } from "@ai-sales/shared";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import * as opportunitiesService from "./opportunities.service.js";
import type { OpportunitiesQuery, OpportunityAccountsQuery, OverdueAccountsQuery, OverdueCustomerBillsQuery } from "./opportunities.schema.js";
import * as overdueService from "./overdue.service.js";
import { getCachedFmsClient } from "../fms/fms-client.factory.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

/** Audits a real generation run (cache miss or force) — the same entry whichever endpoint triggered it. */
async function logGeneration(
  req: Request,
  user: { id: string; companyId: string },
  dto: OpportunitySummaryDTO,
  method: ScoreMethod,
  forced: boolean,
): Promise<void> {
  await logAudit({
    userId: user.id,
    action: "OPPORTUNITIES_GENERATED",
    entityType: "OpportunitySummary",
    entityId: null,
    metadata: {
      companyId: user.companyId,
      counts: dto.counts,
      totalOpportunities: dto.totalOpportunities,
      highPriorityCount: dto.highPriorityCount,
      narratedCount: dto.opportunities.length,
      method,
      forced,
    },
    ipAddress: req.ip ?? null,
  });
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as OpportunitiesQuery;

  const aiProvider = createAIProvider();
  const { dto, wasGenerated, method } = await opportunitiesService.getOpportunities(prisma, aiProvider, {
    companyId: user.companyId,
    limit: query.limit,
    force: query.force,
    type: query.type,
    priority: query.priority,
  });

  if (wasGenerated) await logGeneration(req, user, dto, method, query.force);

  res.status(200).json(dto);
}

/** GET /opportunities/accounts — every opportunity behind one card, from the same cached snapshot as the counts. */
export async function listAccounts(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as OpportunityAccountsQuery;

  const aiProvider = createAIProvider();
  const { dto, wasGenerated, method, summary } = await opportunitiesService.listOpportunityAccounts(prisma, aiProvider, {
    companyId: user.companyId,
    category: query.type,
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
    type: query.opportunityType,
    priority: query.priority,
  });

  if (wasGenerated) await logGeneration(req, user, summary, method, false);

  res.status(200).json(dto);
}

/**
 * GET /opportunities/overdue — accounts with overdue payments (FMS
 * Account_Process sheet), annotated with today's opportunity signals.
 * Same `configured:false` / 502 conventions as the FMS endpoints.
 */
export async function listOverdue(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as OverdueAccountsQuery;

  const client = getCachedFmsClient();
  if (!client) {
    res.status(200).json({
      configured: false,
      message: "FMS integration is not configured on this server. Set FMS_API_URL to enable it.",
    });
    return;
  }

  const aiProvider = createAIProvider();
  const signals = await opportunitiesService.getOpportunitySignalsByAccount(prisma, aiProvider, user.companyId);
  if (signals.wasGenerated) await logGeneration(req, user, signals.summary, signals.method, false);

  const result = await overdueService.getOverdueAccounts(prisma, client, user.companyId, signals.byAccount, {
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
    age: query.age,
    sort: query.sort,
  });

  if (result.status === "upstream_error") {
    res.status(502).json({ error: { message: "Failed to fetch data from the FMS API", details: result.message } });
    return;
  }
  if (result.status === "layout_invalid") {
    res.status(502).json({ error: { message: "The FMS payment sheet's layout was not recognised", details: { problems: result.problems } } });
    return;
  }
  res.status(200).json(result.dto);
}

const FMS_NOT_CONFIGURED = { configured: false, message: "FMS integration is not configured on this server. Set FMS_API_URL to enable it." };

function sendOverdueFailure(res: Response, result: { status: "upstream_error"; message: string } | { status: "layout_invalid"; problems: string[] }): void {
  if (result.status === "upstream_error") {
    res.status(502).json({ error: { message: "Failed to fetch data from the FMS API", details: result.message } });
    return;
  }
  res.status(502).json({ error: { message: "The FMS payment sheet's layout was not recognised", details: { problems: result.problems } } });
}

/** One overdue customer's bills — read-only from the FMS payment sheet; no opportunity generation involved. */
export async function listOverdueCustomerBills(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { accountId } = req.params as { accountId: string };
  const query = req.query as unknown as OverdueCustomerBillsQuery;
  const client = getCachedFmsClient();
  if (!client) {
    res.status(200).json(FMS_NOT_CONFIGURED);
    return;
  }
  const result = await overdueService.getOverdueCustomerBills(prisma, client, user.companyId, accountId, { page: query.page, pageSize: query.pageSize });
  if (result.status === "not_found") {
    res.status(404).json({ error: { message: "This customer has no overdue bills." } });
    return;
  }
  if (result.status !== "ok") return sendOverdueFailure(res, result);
  res.status(200).json(result.dto);
}

/** One bill's payment-sheet rows and its synced FMS order — read-only. */
export async function getOverdueBillDetail(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { billNo } = req.params as { billNo: string };
  const client = getCachedFmsClient();
  if (!client) {
    res.status(200).json(FMS_NOT_CONFIGURED);
    return;
  }
  const result = await overdueService.getOverdueBillDetail(prisma, client, user.companyId, billNo);
  if (result.status === "not_found") {
    res.status(404).json({ error: { message: `Bill No. ${billNo} was not found in the FMS payment sheet.` } });
    return;
  }
  if (result.status !== "ok") return sendOverdueFailure(res, result);
  res.status(200).json(result.dto);
}
