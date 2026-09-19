import { z } from "zod";
import { DAILY_PRIORITY_LEVELS, OPPORTUNITY_TYPES } from "@ai-sales/shared";

/** Caps how many top-ranked candidates get narrated via one batched AI call — cost control, mirrors Phase 3A's SALES_AGENT_DEFAULT_LIMIT/MAX_LIMIT pattern. */
export const OPPORTUNITIES_DEFAULT_LIMIT = 15;
export const OPPORTUNITIES_MAX_LIMIT = 30;

export const opportunitiesQuerySchema = z.object({
  type: z.enum(OPPORTUNITY_TYPES).optional(),
  priority: z.enum(DAILY_PRIORITY_LEVELS).optional(),
  limit: z.coerce.number().int().positive().max(OPPORTUNITIES_MAX_LIMIT).default(OPPORTUNITIES_DEFAULT_LIMIT),
  force: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false" as const),
});
export type OpportunitiesQuery = z.infer<typeof opportunitiesQuerySchema>;

/**
 * Strict schema for one entry of the AI's batched opportunity-narration
 * response. Deliberately has NO field for type/leadId's sibling data (score,
 * classification, productId, priority, etc.) — `id` is the only identifying
 * field, and it is checked against the real requested opportunity ids below,
 * never trusted to carry any other meaning. `z.object()` (not `.strict()`)
 * is used deliberately: any extra field the model includes (e.g. a rogue
 * "score" or "productId") is silently STRIPPED by zod's default behavior
 * rather than rejected — documented here as the chosen behavior (see
 * opportunities.schema.test.ts) so there is structurally nothing for the AI
 * to override even if it tries.
 */
export const aiOpportunityEntrySchema = z.object({
  id: z.string().trim().min(1),
  narrative: z.string().trim().min(1).max(500),
  recommendedAction: z.string().trim().min(1).max(300),
});

export const aiOpportunityResponseSchema = z.array(aiOpportunityEntrySchema).min(1);

export type AIOpportunityEntry = z.infer<typeof aiOpportunityEntrySchema>;

/**
 * Parses raw AI completion text as a JSON array and validates it against
 * `aiOpportunityResponseSchema`, then enforces a full bijection against
 * `requestedIds` (the real, already-detected opportunity ids sent in the
 * prompt) — exactly one entry per requested id, no invented ids, no
 * duplicates, none missing. Any mismatch rejects the WHOLE batch (the
 * caller falls back to RULE_BASED for everything) rather than silently
 * patching gaps, mirroring sales-agent.schema.ts's
 * parseAISalesAgentResponse exactly.
 *
 * Never throws — returns null on any failure so the caller can retry or
 * fall back.
 */
export function parseAIOpportunityResponse(rawContent: string, requestedIds: string[]): AIOpportunityEntry[] | null {
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

  const result = aiOpportunityResponseSchema.safeParse(parsedJson);
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
