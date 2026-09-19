/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FollowUpDTO, LeadType } from "@ai-sales/shared";

/**
 * FollowUp is polymorphic via accountId/prospectId (the same XOR invariant
 * LeadScore established in Phase 2) but the public DTO exposes it as a
 * single leadId/leadType/leadName pair, mirroring how the rest of this
 * phase's design (and LeadScore's own consumers) present a lead. Requires
 * the caller to have included `account: { select: { name: true } }` and
 * `prospect: { select: { businessName: true } }` in the query.
 */
export function toFollowUpDTO(row: any): FollowUpDTO {
  const leadType: LeadType = row.accountId ? "accounts" : "prospects";
  const leadId: string = row.accountId ?? row.prospectId;
  const leadName: string = row.account?.name ?? row.prospect?.businessName ?? "";

  return {
    id: row.id,
    leadId,
    leadType,
    leadName,
    dueDate: (row.dueDate instanceof Date ? row.dueDate : new Date(row.dueDate)).toISOString(),
    notes: row.notes ?? null,
    status: row.status,
    completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt : new Date(row.completedAt)).toISOString() : null,
    completionNotes: row.completionNotes ?? null,
    assignedUserId: row.assignedUserId ?? null,
    assignedUserName: row.assignedUser?.name ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}
