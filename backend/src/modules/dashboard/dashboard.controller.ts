import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { getDashboardOverview } from "./dashboard.service.js";
import { getDashboardInsights } from "./dashboard-insights.service.js";
import { getSalesTrend } from "./sales-trend.service.js";
import type { SalesTrendQuery } from "./dashboard.schema.js";

export async function overview(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  const dashboard = await getDashboardOverview(prisma, req.user.companyId);
  res.status(200).json(dashboard);
}

/**
 * GET /api/dashboard/insights — composes real, already-computed output from
 * Opportunities/Market Expansion/Distributor Expansion/Advertising
 * Analytics/Revenue Analytics into the redesigned dashboard's "Problems to
 * Fix" / "Growth Opportunities" panels. Open to every authenticated role
 * (read-only, same risk profile as the existing /overview endpoint) — no
 * `force` param, since this endpoint never itself decides to bypass a cache;
 * each underlying source's own daily cache/AI pipeline governs that.
 */
export async function insights(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  const aiProvider = createAIProvider();
  const dto = await getDashboardInsights(prisma, aiProvider, req.user.companyId);
  res.status(200).json(dto);
}

/**
 * GET /api/dashboard/sales-trend — real, live (uncached) filtered Sales
 * Trend + Top Products + Distributor Performance from the SAME filtered
 * order set. Open to every authenticated role (read-only).
 */
export async function salesTrend(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  const query = req.query as unknown as SalesTrendQuery;
  const dto = await getSalesTrend(prisma, req.user.companyId, {
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    stateId: query.stateId,
    productId: query.productId,
    distributorId: query.distributorId,
  });
  res.status(200).json(dto);
}
