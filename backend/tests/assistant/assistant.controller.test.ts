import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/* -------------------------------------------------------------------------
 * Test #11: RBAC — SALES_USER can call POST /assistant/ask successfully, no
 * elevated permission required. assistant.routes.ts wires this endpoint
 * with only `requireAuth` (no `requireRole` call at all, unlike the
 * force=true branch of sales-agent/today), so the meaningful behavior to
 * verify is that the controller/service produce a normal 200 response for
 * every authenticated role — nothing here branches on req.user.role.
 * ---------------------------------------------------------------------- */

const auditCreate = vi.fn(async () => ({}));
vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    account: { findMany: async () => [] },
    prospect: { findMany: async () => [] },
    leadScore: {
      findMany: async () => [{ accountId: "acc_1", prospectId: null, score: 91, classification: "HOT", account: { name: "Acme" } }],
    },
    salesRecord: { findMany: async () => [] },
    product: { findMany: async () => [] },
    auditLog: { create: (...args: unknown[]) => auditCreate(...args) },
  },
}));

// Imported after the mock is registered so assistant.controller.js picks up the mocked prisma.
const assistantController = await import("../../src/modules/assistant/assistant.controller.js");

function makeReq(role: string, question: string): Request {
  return {
    user: { id: "u1", role, companyId: "c1" },
    body: { question },
    ip: "127.0.0.1",
  } as unknown as Request;
}

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("POST /assistant/ask — RBAC", () => {
  beforeEach(() => {
    auditCreate.mockClear();
  });

  it("SALES_USER can successfully ask a matched question (no elevated permission required)", async () => {
    const req = makeReq("SALES_USER", "Which HOT leads need attention?");
    const res = makeRes();
    await assistantController.ask(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.matchedIntentId).toBe("hot_leads");
  });

  it("MANAGER and ADMIN can also successfully ask (same, unrestricted, endpoint)", async () => {
    for (const role of ["MANAGER", "ADMIN"]) {
      const req = makeReq(role, "Which HOT leads need attention?");
      const res = makeRes();
      await assistantController.ask(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    }
  });

  it("audits a matched question", async () => {
    const req = makeReq("SALES_USER", "Which HOT leads need attention?");
    const res = makeRes();
    await assistantController.ask(req, res);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data.action).toBe("ASSISTANT_QUESTION_ANSWERED");
  });

  it("skips audit logging for an unmatched question (no real action occurred)", async () => {
    const req = makeReq("SALES_USER", "what's the weather today");
    const res = makeRes();
    await assistantController.ask(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.matchedIntentId).toBeNull();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
