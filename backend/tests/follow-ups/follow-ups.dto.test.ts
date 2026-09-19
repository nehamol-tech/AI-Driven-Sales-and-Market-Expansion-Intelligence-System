import { describe, it, expect } from "vitest";
import { toFollowUpDTO } from "../../src/modules/follow-ups/follow-ups.dto.js";

describe("toFollowUpDTO", () => {
  it("derives leadType='accounts' and leadName from account.name when accountId is set", () => {
    const dto = toFollowUpDTO({
      id: "fu1",
      accountId: "a1",
      prospectId: null,
      dueDate: new Date("2026-08-20T00:00:00Z"),
      notes: null,
      status: "PENDING",
      completedAt: null,
      completionNotes: null,
      assignedUserId: null,
      createdAt: new Date("2026-08-18T00:00:00Z"),
      account: { name: "Acme Corp" },
      prospect: null,
      assignedUser: null,
    });
    expect(dto.leadType).toBe("accounts");
    expect(dto.leadId).toBe("a1");
    expect(dto.leadName).toBe("Acme Corp");
  });

  it("derives leadType='prospects' and leadName from prospect.businessName when prospectId is set", () => {
    const dto = toFollowUpDTO({
      id: "fu2",
      accountId: null,
      prospectId: "p1",
      dueDate: new Date("2026-08-20T00:00:00Z"),
      notes: "Follow up on quote",
      status: "PENDING",
      completedAt: null,
      completionNotes: null,
      assignedUserId: "u2",
      createdAt: new Date("2026-08-18T00:00:00Z"),
      account: null,
      prospect: { businessName: "Beta Traders" },
      assignedUser: { name: "Priya" },
    });
    expect(dto.leadType).toBe("prospects");
    expect(dto.leadId).toBe("p1");
    expect(dto.leadName).toBe("Beta Traders");
    expect(dto.assignedUserId).toBe("u2");
    expect(dto.assignedUserName).toBe("Priya");
    expect(dto.notes).toBe("Follow up on quote");
  });

  it("maps completedAt/completionNotes to null when not completed", () => {
    const dto = toFollowUpDTO({
      id: "fu3",
      accountId: "a1",
      prospectId: null,
      dueDate: new Date("2026-08-20T00:00:00Z"),
      notes: null,
      status: "PENDING",
      completedAt: null,
      completionNotes: null,
      assignedUserId: null,
      createdAt: new Date("2026-08-18T00:00:00Z"),
      account: { name: "Acme Corp" },
      prospect: null,
      assignedUser: null,
    });
    expect(dto.completedAt).toBeNull();
    expect(dto.completionNotes).toBeNull();
  });

  it("serializes completedAt as an ISO string when set", () => {
    const dto = toFollowUpDTO({
      id: "fu4",
      accountId: "a1",
      prospectId: null,
      dueDate: new Date("2026-08-20T00:00:00Z"),
      notes: null,
      status: "COMPLETED",
      completedAt: new Date("2026-08-19T08:30:00Z"),
      completionNotes: "Done",
      assignedUserId: null,
      createdAt: new Date("2026-08-18T00:00:00Z"),
      account: { name: "Acme Corp" },
      prospect: null,
      assignedUser: null,
    });
    expect(dto.completedAt).toBe("2026-08-19T08:30:00.000Z");
    expect(dto.completionNotes).toBe("Done");
  });
});
