import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../../src/lib/errors.js";
import { requireRole } from "../../src/middleware/role.middleware.js";

/**
 * The scoring-trigger routes (`POST /leads/accounts/:id/score`,
 * `POST /leads/prospects/:id/score`, `POST /leads/score-batch`) and prospect
 * deletion are wired with `requireRole("ADMIN", "MANAGER")` — SALES_USER
 * must be forbidden, MANAGER and ADMIN must be allowed. This exercises the
 * exact role set those routes use.
 */
function makeReq(role: string): Request {
  return { user: { id: "u1", role, companyId: "c1" } } as unknown as Request;
}

describe("RBAC on lead scoring endpoints (requireRole('ADMIN', 'MANAGER'))", () => {
  it("forbids SALES_USER from triggering a score", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER to trigger a score", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("MANAGER"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows ADMIN to trigger a score", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("ADMIN"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });
});

describe("RBAC on prospect deletion (requireRole('ADMIN', 'MANAGER'))", () => {
  it("forbids SALES_USER from deleting a prospect", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER and ADMIN to delete a prospect", () => {
    const nextManager = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("MANAGER"), {} as Response, nextManager as NextFunction);
    expect(nextManager).toHaveBeenCalledWith();

    const nextAdmin = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("ADMIN"), {} as Response, nextAdmin as NextFunction);
    expect(nextAdmin).toHaveBeenCalledWith();
  });
});
