import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../../src/lib/errors.js";
import { requireRole } from "../../src/middleware/role.middleware.js";
import { requireRoleIfForce } from "../../src/modules/advertising/advertising-analytics.routes.js";

function makeReq(role: string, query: Record<string, string> = {}): Request {
  return { user: { id: "u1", role, companyId: "c1" }, query } as unknown as Request;
}

/**
 * `POST /:platform/authorize`, `GET /:platform/callback`, and
 * `DELETE /:platform` on ad-connections.routes.ts are wired with
 * `requireRole("ADMIN")` — connecting/disconnecting real OAuth credentials
 * is more sensitive than the usual ADMIN/MANAGER force-gate pattern, so even
 * MANAGER must be forbidden here (matches users.routes.ts's ADMIN-only
 * precedent). `GET /` (list connections) has no requireRole at all — open to
 * every authenticated role, including SALES_USER (not tested here directly
 * since there is nothing to assert beyond "no middleware runs", exactly like
 * follow-ups.rbac.test.ts's treatment of its own open routes).
 */
describe("RBAC on ad-connections authorize/callback/disconnect (requireRole('ADMIN'))", () => {
  it("forbids SALES_USER", () => {
    const next = vi.fn();
    requireRole("ADMIN")(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("forbids MANAGER — stricter than the usual ADMIN/MANAGER pattern", () => {
    const next = vi.fn();
    requireRole("ADMIN")(makeReq("MANAGER"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows ADMIN", () => {
    const next = vi.fn();
    requireRole("ADMIN")(makeReq("ADMIN"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });
});

/**
 * `POST /:platform/sync` is wired with `requireRole("ADMIN", "MANAGER")` —
 * reading real ad data is less sensitive than connecting credentials, so
 * this matches the more common ADMIN/MANAGER precedent instead.
 */
describe("RBAC on ad-connections sync (requireRole('ADMIN', 'MANAGER'))", () => {
  it("forbids SALES_USER", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER and ADMIN", () => {
    const nextManager = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("MANAGER"), {} as Response, nextManager as NextFunction);
    expect(nextManager).toHaveBeenCalledWith();

    const nextAdmin = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("ADMIN"), {} as Response, nextAdmin as NextFunction);
    expect(nextAdmin).toHaveBeenCalledWith();
  });
});

/**
 * `DELETE /api/advertising/campaigns/:id` and
 * `DELETE /api/advertising/campaigns/:id/spend/:spendId` are wired with
 * `requireRole("ADMIN", "MANAGER")` — matches Prospect/FollowUp's delete
 * precedent exactly. `GET`/`POST`/`PUT` on campaigns and spend records have
 * no requireRole at all — open to every authenticated role, including
 * SALES_USER (matches Prospect/SalesRecord's creation precedent).
 */
describe("RBAC on ad-campaigns/spend-record deletion (requireRole('ADMIN', 'MANAGER'))", () => {
  it("forbids SALES_USER from deleting a campaign", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER and ADMIN to delete a campaign", () => {
    const nextManager = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("MANAGER"), {} as Response, nextManager as NextFunction);
    expect(nextManager).toHaveBeenCalledWith();

    const nextAdmin = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("ADMIN"), {} as Response, nextAdmin as NextFunction);
    expect(nextAdmin).toHaveBeenCalledWith();
  });
});

/**
 * `GET /api/advertising/analytics?force=true` bypasses the daily cache and
 * always triggers a real AI call, so — mirroring revenue-analytics.routes.ts
 * exactly — it's restricted to ADMIN/MANAGER. A plain GET (no force, or
 * force=false) is open to every authenticated role, including SALES_USER.
 */
describe("RBAC on GET /api/advertising/analytics (requireRoleIfForce)", () => {
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
