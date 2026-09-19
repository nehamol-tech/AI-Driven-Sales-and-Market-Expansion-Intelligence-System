import { z } from "zod";
import { OPTIMIZATION_RECOMMENDATION_STATUSES, OPTIMIZATION_RECOMMENDATION_TYPES } from "@ai-sales/shared";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants.js";

export const listOptimizationQuerySchema = z.object({
  status: z.enum(OPTIMIZATION_RECOMMENDATION_STATUSES).optional(),
  type: z.enum(OPTIMIZATION_RECOMMENDATION_TYPES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListOptimizationQuery = z.infer<typeof listOptimizationQuerySchema>;

export const recommendationIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

/**
 * Strict schema for one entry of the AI's batched optimization-narration
 * response. Deliberately has NO field beyond id/narrative — `id` is the only
 * identifying field, checked against the real requested candidate ids below,
 * never trusted to carry any other meaning. `z.object()` (not `.strict()`)
 * is used deliberately, mirroring opportunities.schema.ts exactly: any extra
 * field the model includes is silently stripped by zod's default behavior
 * rather than rejected.
 */
export const aiOptimizationEntrySchema = z.object({
  id: z.string().trim().min(1),
  narrative: z.string().trim().min(1).max(500),
});

export const aiOptimizationResponseSchema = z.array(aiOptimizationEntrySchema).min(1);

export type AIOptimizationEntry = z.infer<typeof aiOptimizationEntrySchema>;

/**
 * Parses raw AI completion text as a JSON array and validates it against
 * `aiOptimizationResponseSchema`, then enforces a full bijection against
 * `requestedIds` (the real, already-persisted candidate ids sent in the
 * prompt) — exactly one entry per requested id, no invented ids, no
 * duplicates, none missing. Any mismatch rejects the WHOLE batch (the caller
 * falls back to RULE_BASED for every candidate) rather than silently
 * patching gaps, mirroring opportunities.schema.ts's
 * parseAIOpportunityResponse exactly.
 *
 * Never throws — returns null on any failure so the caller can retry or
 * fall back.
 */
export function parseAIOptimizationResponse(rawContent: string, requestedIds: string[]): AIOptimizationEntry[] | null {
  let parsedJson: unknown;
  try {
    const cleaned = rawContent
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    parsedJson = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const result = aiOptimizationResponseSchema.safeParse(parsedJson);
  if (!result.success) return null;
  const entries = result.data;

  const requestedIdSet = new Set(requestedIds);
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (!requestedIdSet.has(entry.id)) return null; // invented id
    if (seenIds.has(entry.id)) return null; // duplicate
    seenIds.add(entry.id);
  }
  if (seenIds.size !== requestedIdSet.size) return null; // missing one or more requested ids

  return entries;
}
