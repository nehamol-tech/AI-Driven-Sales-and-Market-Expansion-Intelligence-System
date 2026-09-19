import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../../src/lib/errors.js";
import { requireRole } from "../../src/middleware/role.middleware.js";

/**
 * `DELETE /api/follow-ups/:id` is wired with `requireRole("ADMIN", "MANAGER")`
 * (mirrors prospects.routes.ts's prospect-deletion RBAC exactly) — every
 * other follow-ups route (list/create/update) has no `requireRole` at all,
 * i.e. open to any authenticated role including SALES_USER (test #7).
 */
function makeReq(role: string): Request {
  return { user: { id: "u1", role, companyId: "c1" } } as unknown as Request;
}

describe("RBAC on DELETE /api/follow-ups/:id (requireRole('ADMIN', 'MANAGER'))", () => {
  it("forbids SALES_USER from deleting a follow-up", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER to delete a follow-up", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("MANAGER"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows ADMIN to delete a follow-up", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("ADMIN"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });
});
