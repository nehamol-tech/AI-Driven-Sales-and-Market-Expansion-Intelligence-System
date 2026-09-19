import { describe, it, expect } from "vitest";
import {
  createFollowUpSchema,
  updateFollowUpSchema,
  listFollowUpsQuerySchema,
  followUpIdParamSchema,
} from "../../src/modules/follow-ups/follow-ups.schema.js";

describe("createFollowUpSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = createFollowUpSchema.parse({ leadId: "a1", leadType: "accounts", dueDate: "2026-08-20T00:00:00Z" });
    expect(result.leadId).toBe("a1");
    expect(result.leadType).toBe("accounts");
    expect(result.dueDate).toBeInstanceOf(Date);
  });

  it("rejects a payload missing leadId", () => {
    expect(() => createFollowUpSchema.parse({ leadType: "accounts", dueDate: "2026-08-20T00:00:00Z" })).toThrow();
  });

  it("rejects an invalid leadType", () => {
    expect(() => createFollowUpSchema.parse({ leadId: "a1", leadType: "companies", dueDate: "2026-08-20T00:00:00Z" })).toThrow();
  });

  it("rejects a missing dueDate", () => {
    expect(() => createFollowUpSchema.parse({ leadId: "a1", leadType: "accounts" })).toThrow();
  });

  it("accepts a full payload with notes and assignedUserId", () => {
    const result = createFollowUpSchema.parse({
      leadId: "p1",
      leadType: "prospects",
      dueDate: "2026-08-20T00:00:00Z",
      notes: "Call about renewal",
      assignedUserId: "u1",
    });
    expect(result.notes).toBe("Call about renewal");
    expect(result.assignedUserId).toBe("u1");
  });

  it("leaves assignedUserId as undefined when omitted (not defaulted at the schema layer)", () => {
    const result = createFollowUpSchema.parse({ leadId: "a1", leadType: "accounts", dueDate: "2026-08-20T00:00:00Z" });
    expect(result.assignedUserId).toBeUndefined();
  });
});

describe("updateFollowUpSchema", () => {
  it("accepts a partial payload with only status", () => {
    const result = updateFollowUpSchema.parse({ status: "COMPLETED" });
    expect(result.status).toBe("COMPLETED");
  });

  it("rejects an invalid status value", () => {
    expect(() => updateFollowUpSchema.parse({ status: "DONE" })).toThrow();
  });

  it("has no completedAt field in its type at all — a client-supplied completedAt is silently stripped (zod's default 'strip' object mode), never trusted", () => {
    const result = updateFollowUpSchema.parse({ status: "COMPLETED", completedAt: "2000-01-01T00:00:00Z" } as unknown as Record<string, unknown>);
    expect(result).not.toHaveProperty("completedAt");
  });

  it("accepts completionNotes alongside COMPLETED", () => {
    const result = updateFollowUpSchema.parse({ status: "COMPLETED", completionNotes: "Closed the deal" });
    expect(result.completionNotes).toBe("Closed the deal");
  });

  it("does not require completionNotes when setting COMPLETED (not hard-blocked)", () => {
    expect(() => updateFollowUpSchema.parse({ status: "COMPLETED" })).not.toThrow();
  });

  it("allows completionNotes even without a status change", () => {
    expect(() => updateFollowUpSchema.parse({ completionNotes: "just a note" })).not.toThrow();
  });
});

describe("listFollowUpsQuerySchema", () => {
  it("defaults dueBy to 'all' and limit to the default", () => {
    const result = listFollowUpsQuerySchema.parse({});
    expect(result.dueBy).toBe("all");
    expect(result.limit).toBe(50);
  });

  it("rejects an invalid dueBy filter", () => {
    expect(() => listFollowUpsQuerySchema.parse({ dueBy: "yesterday" })).toThrow();
  });

  it("accepts each valid dueBy value", () => {
    for (const dueBy of ["overdue", "today", "week", "all"]) {
      expect(() => listFollowUpsQuerySchema.parse({ dueBy })).not.toThrow();
    }
  });

  it("rejects an invalid status filter", () => {
    expect(() => listFollowUpsQuerySchema.parse({ status: "IN_PROGRESS" })).toThrow();
  });

  it("rejects an invalid leadType filter", () => {
    expect(() => listFollowUpsQuerySchema.parse({ leadType: "companies" })).toThrow();
  });

  it("coerces and caps limit at the max", () => {
    expect(() => listFollowUpsQuerySchema.parse({ limit: "9999" })).toThrow();
  });
});

describe("followUpIdParamSchema", () => {
  it("accepts a non-empty id", () => {
    expect(followUpIdParamSchema.parse({ id: "fu1" }).id).toBe("fu1");
  });

  it("rejects an empty id", () => {
    expect(() => followUpIdParamSchema.parse({ id: "" })).toThrow();
  });
});
