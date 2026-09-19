import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { signSessionToken } from "../../src/lib/jwt.js";
import { SESSION_COOKIE_NAME } from "../../src/config/constants.js";
import { UnauthorizedError, ForbiddenError } from "../../src/lib/errors.js";
import { requireRole } from "../../src/middleware/role.middleware.js";

const findUnique = vi.fn();
vi.mock("../../src/lib/prisma.js", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));
// requireAuth must be imported after the mock is registered so it picks up the mocked prisma.
const { requireAuth } = await import("../../src/middleware/auth.middleware.js");

function makeReq(cookies: Record<string, string> = {}): Request {
  return { cookies } as unknown as Request;
}

describe("requireAuth middleware", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("calls next with UnauthorizedError when no session cookie is present", async () => {
    const req = makeReq();
    const next = vi.fn();
    await requireAuth(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("calls next with UnauthorizedError when the token is invalid", async () => {
    const req = makeReq({ [SESSION_COOKIE_NAME]: "garbage-token" });
    const next = vi.fn();
    await requireAuth(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });

  it("attaches req.user (from the DB, not the token) and calls next() for a valid token + active user", async () => {
    findUnique.mockResolvedValue({ id: "u1", role: "MANAGER", companyId: "c1", isActive: true });
    const token = signSessionToken({ userId: "u1", role: "SALES_USER", companyId: "c1" });
    const req = makeReq({ [SESSION_COOKIE_NAME]: token });
    const next = vi.fn();
    await requireAuth(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
    // role comes from the fresh DB row (MANAGER), not the stale token claim (SALES_USER).
    expect(req.user).toEqual({ id: "u1", role: "MANAGER", companyId: "c1" });
  });

  it("rejects a valid token whose user has since been deactivated", async () => {
    findUnique.mockResolvedValue({ id: "u1", role: "SALES_USER", companyId: "c1", isActive: false });
    const token = signSessionToken({ userId: "u1", role: "SALES_USER", companyId: "c1" });
    const req = makeReq({ [SESSION_COOKIE_NAME]: token });
    const next = vi.fn();
    await requireAuth(req, {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a valid token whose user no longer exists", async () => {
    findUnique.mockResolvedValue(null);
    const token = signSessionToken({ userId: "deleted-user", role: "SALES_USER", companyId: "c1" });
    const req = makeReq({ [SESSION_COOKIE_NAME]: token });
    const next = vi.fn();
    await requireAuth(req, {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });
});

describe("requireRole middleware", () => {
  it("calls next with ForbiddenError when the user's role is not in the allowed list", () => {
    const req = { user: { id: "u1", role: "SALES_USER", companyId: "c1" } } as unknown as Request;
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(req, {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("calls next() with no error when the user's role is allowed", () => {
    const req = { user: { id: "u1", role: "MANAGER", companyId: "c1" } } as unknown as Request;
    const next = vi.fn();
    requireRole("ADMIN", "MANAGER")(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("always allows ADMIN through, even when ADMIN is not in the explicit role list", () => {
    const req = { user: { id: "u1", role: "ADMIN", companyId: "c1" } } as unknown as Request;
    const next = vi.fn();
    requireRole("SALES_USER")(req, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it("calls next with UnauthorizedError when req.user is missing", () => {
    const req = {} as unknown as Request;
    const next = vi.fn();
    requireRole("ADMIN")(req, {} as Response, next as NextFunction);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });
});
