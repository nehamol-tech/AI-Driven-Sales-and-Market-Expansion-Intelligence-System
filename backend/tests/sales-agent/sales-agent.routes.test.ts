import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../../src/lib/errors.js";

const rateLimiterSpy = vi.fn((_req: Request, _res: Response, next: NextFunction) => next());
vi.mock("../../src/middleware/rate-limit.middleware.js", () => ({
  leadScoringRateLimiter: (req: Request, res: Response, next: NextFunction) => rateLimiterSpy(req, res, next),
}));

// Imported after the mock is registered so sales-agent.routes.js picks up the mocked rate limiter.
const { requireRoleIfForce, rateLimitIfGenerating } = await import("../../src/modules/sales-agent/sales-agent.routes.js");
const { clearSalesAgentCache, getSalesAgentToday } = await import("../../src/modules/sales-agent/sales-agent.service.js");

function makeReq(role: string, query: Record<string, string> = {}): Request {
  return { user: { id: "u1", role, companyId: "c1" }, query } as unknown as Request;
}

/* -------------------------------------------------------------------------
 * Test #9: force=true requires ADMIN/MANAGER (403 for SALES_USER); a plain
 * GET works for every role.
 * ---------------------------------------------------------------------- */

describe("requireRoleIfForce", () => {
  it("allows a plain GET (no force) through for any role, including SALES_USER", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("forbids SALES_USER from passing force=true", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("SALES_USER", { force: "true" }), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER to pass force=true", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("MANAGER", { force: "true" }), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows ADMIN to pass force=true", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("ADMIN", { force: "true" }), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("treats force=false the same as no force at all (open to every role)", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("SALES_USER", { force: "false" }), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });
});

describe("rateLimitIfGenerating", () => {
  beforeEach(() => {
    clearSalesAgentCache();
    rateLimiterSpy.mockClear();
  });

  it("applies the rate limiter when there is no cache entry yet (cache miss)", () => {
    const next = vi.fn();
    rateLimitIfGenerating(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(rateLimiterSpy).toHaveBeenCalledTimes(1);
  });

  it("applies the rate limiter whenever force=true, even with a fresh cache entry", async () => {
    const deps = { leadScore: { findMany: async () => [] }, salesRecord: { findMany: async () => [] }, product: { findMany: async () => [] } };
    const provider = { name: "fake", generateCompletion: async () => ({ content: "[]" }) };
    await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false });

    const next = vi.fn();
    rateLimitIfGenerating(makeReq("ADMIN", { force: "true" }), {} as Response, next as NextFunction);
    expect(rateLimiterSpy).toHaveBeenCalledTimes(1);
  });

  it("skips the rate limiter on a cache hit (no generation needed)", async () => {
    const deps = { leadScore: { findMany: async () => [] }, salesRecord: { findMany: async () => [] }, product: { findMany: async () => [] } };
    const provider = { name: "fake", generateCompletion: async () => ({ content: "[]" }) };
    await getSalesAgentToday(deps, provider, { companyId: "c1", limit: 10, force: false });

    const next = vi.fn();
    rateLimitIfGenerating(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(rateLimiterSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });
});
