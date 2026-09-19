import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../../src/lib/errors.js";
import { requireRole } from "../../src/middleware/role.middleware.js";
import { requireRoleIfForce } from "../../src/modules/distributors/distributors.routes.js";

function makeReq(role: string, query: Record<string, string> = {}): Request {
  return { user: { id: "u1", role, companyId: "c1" }, query } as unknown as Request;
}

/**
 * `GET /`, `POST /`, `GET /:id`, `PUT /:id` on distributors.routes.ts have no
 * requireRole at all — open to every authenticated role, including
 * SALES_USER (matches Prospect/SalesRecord/AdCampaign's creation precedent).
 * Only `DELETE /:id` is restricted to ADMIN/MANAGER, matching AdCampaign's
 * delete precedent exactly.
 */
describe("RBAC on distributor deletion (requireRole('ADMIN', 'MANAGER'))", () => {
  it("forbids SALES_USER from deleting a distributor", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER and ADMIN to delete a distributor", () => {
    const nextManager = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("MANAGER"), {} as Response, nextManager as NextFunction);
    expect(nextManager).toHaveBeenCalledWith();

    const nextAdmin = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("ADMIN"), {} as Response, nextAdmin as NextFunction);
    expect(nextAdmin).toHaveBeenCalledWith();
  });
});

/**
 * `GET /api/distributors/expansion?force=true` bypasses the daily cache and
 * always triggers a real AI call, so — mirroring advertising-analytics.routes.ts
 * and market-expansion.routes.ts exactly — it's restricted to ADMIN/MANAGER.
 * A plain GET (no force, or force=false) is open to every authenticated
 * role, including SALES_USER.
 */
describe("RBAC on GET /api/distributors/expansion (requireRoleIfForce)", () => {
  it("passes a plain GET (no force param) through for SALES_USER", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("passes force=false through for SALES_USER", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("SALES_USER", { force: "false" }), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("forbids SALES_USER from force=true", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("SALES_USER", { force: "true" }), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER to force=true", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("MANAGER", { force: "true" }), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows ADMIN to force=true", () => {
    const next = vi.fn();
    requireRoleIfForce(makeReq("ADMIN", { force: "true" }), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });
});
