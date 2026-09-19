import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../../src/lib/errors.js";
import { requireRole } from "../../src/middleware/role.middleware.js";

function makeReq(role: string): Request {
  return { user: { id: "u1", role, companyId: "c1" }, query: {} } as unknown as Request;
}

/**
 * optimization.routes.ts applies `requireRole("ADMIN", "MANAGER")` directly
 * (no force-param conditional like opportunities/distributors) to
 * POST /generate, POST /:id/approve, and POST /:id/reject — this endpoint
 * always does real work (persists rows / mutates business state) when
 * reached, so there's no "cache hit, open to everyone" case to carve out.
 * GET / and GET /:id have no requireRole at all — open to every
 * authenticated role, matching the read-path precedent of every other
 * phase (opportunities, distributors, follow-ups).
 */
describe("RBAC on POST /api/optimization/generate, /:id/approve, /:id/reject (requireRole('ADMIN', 'MANAGER'))", () => {
  it("forbids SALES_USER", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("SALES_USER"), {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("allows MANAGER", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("MANAGER"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows ADMIN", () => {
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(makeReq("ADMIN"), {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });
});
