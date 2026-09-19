import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../../src/lib/errors.js";
import { requireRoleIfForce } from "../../src/modules/revenue-analytics/revenue-analytics.routes.js";

/**
 * `GET /api/revenue-analytics?force=true` bypasses the daily cache and
 * always triggers a real AI call, so it's restricted to ADMIN/MANAGER
 * (mirrors market-expansion.routes.ts's requireRoleIfForce exactly). A
 * plain GET (no `force`, or `force=false`) is open to every authenticated
 * role, including SALES_USER.
 */
function makeReq(role: string, force?: string): Request {
  return {
    user: { id: "u1", role, companyId: "c1" },
    query: force !== undefined ? { force } : {},
  } as unknown as Request;
}

describe("RBAC on GET /api/revenue-analytics (requireRoleIfForce)", () => {
  it("passes a plain GET (no force param) through for SALES_USER", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("passes force=false through for SALES_USER", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("SALES_USER", "false"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("forbids SALES_USER from force=true", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("SALES_USER", "true"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER to force=true", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("MANAGER", "true"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows ADMIN to force=true", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("ADMIN", "true"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });
});
