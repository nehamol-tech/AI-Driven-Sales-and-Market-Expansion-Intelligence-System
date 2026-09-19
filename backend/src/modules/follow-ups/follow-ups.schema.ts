import { z } from "zod";
import { FOLLOW_UP_STATUSES, FOLLOW_UP_DUE_BY_FILTERS } from "@ai-sales/shared";

/** Caps how many rows `items` can return — mirrors the narration-cap pattern established elsewhere (e.g. opportunities/sales-agent): the summary counts are always computed independently of this cap. */
export const FOLLOW_UPS_DEFAULT_LIMIT = 50;
export const FOLLOW_UPS_MAX_LIMIT = 200;

export const listFollowUpsQuerySchema = z.object({
  status: z.enum(FOLLOW_UP_STATUSES).optional(),
  dueBy: z.enum(FOLLOW_UP_DUE_BY_FILTERS).default("all"),
  leadType: z.enum(["accounts", "prospects"]).optional(),
  limit: z.coerce.number().int().positive().max(FOLLOW_UPS_MAX_LIMIT).default(FOLLOW_UPS_DEFAULT_LIMIT),
});
export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;

export const createFollowUpSchema = z.object({
  leadId: z.string().trim().min(1, "leadId is required"),
  leadType: z.enum(["accounts", "prospects"]),
  dueDate: z.coerce.date(),
  notes: z.string().trim().max(2000).nullable().optional(),
  assignedUserId: z.string().trim().min(1).nullable().optional(),
});
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

/**
 * Deliberately has NO `completedAt` field — completedAt is always set
 * server-side (see follow-ups.service.ts's updateFollowUp), so there is
 * structurally nothing in the request body for a client to override it
 * with, mirroring how classification is never trusted from the AI's own
 * output in scoring.service.ts.
 */
export const updateFollowUpSchema = z.object({
  dueDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  assignedUserId: z.string().trim().min(1).nullable().optional(),
  status: z.enum(FOLLOW_UP_STATUSES).optional(),
  completionNotes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>;

export const followUpIdParamSchema = z.object({
  id: z.string().trim().min(1),
});
