import { describe, it, expect, vi, beforeEach } from "vitest";
import { OPPORTUNITY_CATEGORIES, type OpportunityCategory } from "@ai-sales/shared";
import type { AIProvider } from "../../src/lib/ai/ai-provider.interface.js";
import {
  clearOpportunitiesCache,
  getOpportunities,
  listOpportunityAccounts,
  type OpportunitiesPrismaDeps,
} from "../../src/modules/opportunities/opportunities.service.js";

/* -------------------------------------------------------------------------
 * The per-card detail lists must contain EXACTLY the opportunities each
 * card counts, from the same snapshot. The fixture is a deterministic mix
 * of 60 accounts with varied order histories, so several detectors fire and
 * High Priority spans more than one type.
 * ---------------------------------------------------------------------- */

const NOW = new Date("2026-08-17T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

/** AI that always fails, so narration falls back to RULE_BASED deterministically. */
const failingAI: AIProvider = {
  name: "fake",
  async generateCompletion() {
    throw new Error("AI unavailable");
  },
};

function makeDeps() {
  const accounts = [];
  const salesRecords = [];
  for (let i = 0; i < 60; i++) {
    const id = `acc_${String(i).padStart(2, "0")}`;
    accounts.push({ id, name: `Account ${i % 7 === 0 ? "Sharma" : "Trader"} ${i}`, industryId: null, stateId: null, industry: null });
    const orders = 2 + (i % 5);
    const interval = 15 + (i % 4) * 15;
    const lastAgo = (i * 13) % 200;
    for (let k = 0; k < orders; k++) {
      const value = 1000 * (1 + (i % 9)) * (i % 3 === 0 && k >= orders - 2 ? 3 : 1);
      salesRecords.push({ accountId: id, date: daysAgo(lastAgo + (orders - 1 - k) * interval), orderValue: String(value), productId: null });
    }
  }
  const findMany = vi.fn(async () => salesRecords);
  const deps: OpportunitiesPrismaDeps = {
    account: { findMany: async () => accounts },
    salesRecord: { findMany },
    leadScore: { findMany: async () => [] },
    product: { findMany: async () => [] },
  };
  return { deps, salesRecordFindMany: findMany };
}

async function allRows(deps: OpportunitiesPrismaDeps, category: OpportunityCategory, pageSize = 7) {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const { dto } = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category, page, pageSize, now: NOW });
    ids.push(...dto.data.map((r) => r.opportunityId));
    if (dto.data.length < pageSize) return { ids, dto };
  }
}

describe("listOpportunityAccounts", () => {
  beforeEach(() => clearOpportunitiesCache());

  it("returns, for EVERY card, exactly as many opportunities as the card counts — each exactly once", async () => {
    const { deps } = makeDeps();
    const { dto: summary } = await getOpportunities(deps, failingAI, { companyId: "c1", limit: 15, force: false, now: NOW });

    let nonEmptyCategories = 0;
    for (const category of OPPORTUNITY_CATEGORIES) {
      const expected = category === "HIGH_PRIORITY" ? summary.highPriorityCount : summary.counts[category];
      const { ids, dto } = await allRows(deps, category);
      expect(dto.categoryTotal, category).toBe(expected);
      expect(ids.length, category).toBe(expected);
      expect(new Set(ids).size, category).toBe(ids.length);
      if (expected > 0) nonEmptyCategories++;
    }
    expect(nonEmptyCategories).toBeGreaterThanOrEqual(3);
  });

  it("High Priority holds every HIGH opportunity of any type, and reports its distinct accounts separately", async () => {
    const { deps } = makeDeps();
    const { ids, dto } = await allRows(deps, "HIGH_PRIORITY", 100);
    const { dto: page } = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "HIGH_PRIORITY", page: 1, pageSize: 100, now: NOW });
    expect(page.data.every((r) => r.priority === "HIGH")).toBe(true);
    expect(new Set(page.data.map((r) => r.type)).size).toBeGreaterThan(1);
    expect(dto.categoryAccountCount).toBe(new Set(page.data.map((r) => r.accountId)).size);
    expect(dto.categoryAccountCount).toBeLessThanOrEqual(ids.length);
  });

  it("type cards contain only that type", async () => {
    const { deps } = makeDeps();
    const { dto } = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "REORDER", page: 1, pageSize: 100, now: NOW });
    expect(dto.data.length).toBeGreaterThan(0);
    expect(dto.data.every((r) => r.type === "REORDER")).toBe(true);
  });

  it("reads the same cached snapshot as the counts — no new detection run per list request", async () => {
    const { deps, salesRecordFindMany } = makeDeps();
    await getOpportunities(deps, failingAI, { companyId: "c1", limit: 15, force: false, now: NOW });
    expect(salesRecordFindMany).toHaveBeenCalledTimes(1);
    for (const category of OPPORTUNITY_CATEGORIES) {
      await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category, page: 2, pageSize: 5, now: NOW });
    }
    expect(salesRecordFindMany).toHaveBeenCalledTimes(1);
  });

  it("on a cold cache, generates through the normal path once and reports it", async () => {
    const { deps, salesRecordFindMany } = makeDeps();
    const first = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "AT_RISK", page: 1, pageSize: 5, now: NOW });
    const second = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "AT_RISK", page: 1, pageSize: 5, now: NOW });
    expect(first.wasGenerated).toBe(true);
    expect(second.wasGenerated).toBe(false);
    expect(salesRecordFindMany).toHaveBeenCalledTimes(1);
    const { dto: summary } = await getOpportunities(deps, failingAI, { companyId: "c1", limit: 15, force: false, now: NOW });
    expect(first.dto.categoryTotal).toBe(summary.counts.AT_RISK);
    expect(first.dto.generatedAt).toBe(summary.generatedAt);
  });

  it("follows the existing ranking order (priority, then rank signal)", async () => {
    const { deps } = makeDeps();
    const { dto } = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "REORDER", page: 1, pageSize: 100, now: NOW });
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
    const priorities = dto.data.map((r) => rank[r.priority]);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });

  it("searches server-side on account name (case-insensitive) and account id, without changing the card total", async () => {
    const { deps } = makeDeps();
    const all = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "HIGH_PRIORITY", page: 1, pageSize: 100, now: NOW });
    const byName = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "HIGH_PRIORITY", page: 1, pageSize: 100, search: "sHaRmA", now: NOW });
    expect(byName.dto.pagination.total).toBe(all.dto.data.filter((r) => r.accountName.toLowerCase().includes("sharma")).length);
    expect(byName.dto.data.every((r) => r.accountName.includes("Sharma"))).toBe(true);
    expect(byName.dto.categoryTotal).toBe(all.dto.categoryTotal);

    const target = all.dto.data[0];
    const byId = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "HIGH_PRIORITY", page: 1, pageSize: 100, search: target.accountId, now: NOW });
    expect(byId.dto.data.map((r) => r.accountId)).toContain(target.accountId);
    expect(byId.dto.data.every((r) => r.accountId === target.accountId)).toBe(true);
  });

  it("narrows within a card by opportunity type or priority", async () => {
    const { deps } = makeDeps();
    const { dto: summary } = await getOpportunities(deps, failingAI, { companyId: "c1", limit: 15, force: false, now: NOW });
    const hpReorder = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "HIGH_PRIORITY", page: 1, pageSize: 100, type: "REORDER", now: NOW });
    expect(hpReorder.dto.data.every((r) => r.type === "REORDER" && r.priority === "HIGH")).toBe(true);
    const reorderLow = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "REORDER", page: 1, pageSize: 100, priority: "LOW", now: NOW });
    expect(reorderLow.dto.data.every((r) => r.priority === "LOW")).toBe(true);
    expect(reorderLow.dto.categoryTotal).toBe(summary.counts.REORDER);
  });

  it("returns an empty page past the end, and an empty list for a zero-count card", async () => {
    const { deps } = makeDeps();
    const past = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "REORDER", page: 999, pageSize: 25, now: NOW });
    expect(past.dto.data).toEqual([]);
    expect(past.dto.pagination.total).toBeGreaterThan(0);
    const cross = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "CROSS_SELL", page: 1, pageSize: 25, now: NOW });
    expect(cross.dto).toMatchObject({ data: [], categoryTotal: 0, categoryAccountCount: 0, pagination: { total: 0 } });
  });

  it("returns each account's real figures from the same profiles the detectors used", async () => {
    const { deps } = makeDeps();
    const { dto } = await listOpportunityAccounts(deps, failingAI, { companyId: "c1", category: "REORDER", page: 1, pageSize: 1, now: NOW });
    const row = dto.data[0];
    expect(row.orderCount).toBeGreaterThanOrEqual(2);
    expect(Number(row.totalOrderValue)).toBeGreaterThan(0);
    expect(row.totalOrderValue).toMatch(/^\d+\.\d{2}$/);
    expect(row.lastOrderDate).not.toBeNull();
    expect(row.daysSinceLastOrder).toBe(Math.round((NOW.getTime() - new Date(row.lastOrderDate!).getTime()) / DAY));
    expect(row.reason).toBeTruthy();
    expect(row.evidence.length).toBeGreaterThan(0);
  });
});
