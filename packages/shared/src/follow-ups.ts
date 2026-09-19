import type { LeadType } from "./leads.js";

export const FOLLOW_UP_STATUSES = ["PENDING", "COMPLETED", "CANCELLED"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/** Server-side due-date bucket filter — computed relative to "now" on the backend, never on the client. */
export const FOLLOW_UP_DUE_BY_FILTERS = ["overdue", "today", "week", "all"] as const;
export type FollowUpDueByFilter = (typeof FOLLOW_UP_DUE_BY_FILTERS)[number];

/**
 * A scheduled or completed follow-up against a real Account or Prospect —
 * polymorphic via leadId/leadType, mirroring the exact accountId/prospectId
 * XOR pattern LeadScore established in Phase 2. Purely a scheduling/tracking
 * record — nothing here sends a message; "notes"/"completionNotes" are
 * free text a rep types themselves.
 */
export interface FollowUpDTO {
  id: string;
  leadId: string;
  leadType: LeadType;
  leadName: string;
  dueDate: string;
  notes: string | null;
  status: FollowUpStatus;
  completedAt: string | null;
  completionNotes: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  createdAt: string;
}

export interface CreateFollowUpInput {
  leadId: string;
  leadType: LeadType;
  dueDate: string;
  notes?: string;
  assignedUserId?: string;
}

export interface UpdateFollowUpInput {
  dueDate?: string;
  notes?: string;
  assignedUserId?: string;
  status?: FollowUpStatus;
  completionNotes?: string;
}

export interface FollowUpSummaryDTO {
  overdueCount: number;
  todayCount: number;
  weekCount: number;
  items: FollowUpDTO[];
}
