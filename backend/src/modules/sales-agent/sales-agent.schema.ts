import { z } from "zod";

/** Caps how many top-ranked candidates get narrated via one batched AI call — cost control. */
export const SALES_AGENT_DEFAULT_LIMIT = 10;
export const SALES_AGENT_MAX_LIMIT = 25;

export const salesAgentTodayQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(SALES_AGENT_MAX_LIMIT).default(SALES_AGENT_DEFAULT_LIMIT),
  force: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false" as const),
});
export type SalesAgentTodayQuery = z.infer<typeof salesAgentTodayQuerySchema>;

/**
 * Strict schema for one entry of the AI's batched sales-agent narrative
 * response. `leadId`/`score`/`classification` are never part of this shape —
 * those are never trusted from the model. `productSuggestion` shape is
 * validated here only (a non-empty string or null); whether it's actually
 * one of the real candidate product names for that lead is checked
 * separately in `parseAISalesAgentResponse` below, since that check needs
 * per-lead context the schema alone can't see.
 */
export const aiSalesAgentEntrySchema = z.object({
  leadId: z.string().trim().min(1),
  reasons: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  recommendedAction: z.string().trim().min(1).max(300),
  productSuggestion: z.string().trim().min(1).max(300).nullable(),
});

export const aiSalesAgentResponseSchema = z.array(aiSalesAgentEntrySchema).min(1);

export type AISalesAgentEntry = z.infer<typeof aiSalesAgentEntrySchema>;

/**
 * Parses raw AI completion text as a JSON array and validates it against
 * `aiSalesAgentResponseSchema`, then enforces two additional real-data
 * invariants that a JSON schema alone can't express:
 *
 *  1. The response must be a bijection with `requestedLeadIds` — exactly one
 *     entry per requested lead, no invented leadIds, none missing. A partial
 *     or padded response is rejected wholesale (the caller falls back to
 *     RULE_BASED for the whole batch) rather than silently patching gaps.
 *  2. `productSuggestion`, when non-null, must be exactly one of the real
 *     candidate product names supplied for that specific lead
 *     (`productAllowlistByLeadId`). This is what actually prevents the AI
 *     from inventing a product — enforced here at validation time, not just
 *     by prompt instruction.
 *
 * Never throws — returns null on any failure so the caller can retry or
 * fall back.
 */
export function parseAISalesAgentResponse(
  rawContent: string,
  requestedLeadIds: string[],
  productAllowlistByLeadId: Map<string, string[]>,
): AISalesAgentEntry[] | null {
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

  const result = aiSalesAgentResponseSchema.safeParse(parsedJson);
  if (!result.success) return null;
  const entries = result.data;

  const requestedIdSet = new Set(requestedLeadIds);
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (!requestedIdSet.has(entry.leadId)) return null; // invented leadId
    if (seenIds.has(entry.leadId)) return null; // duplicate
    seenIds.add(entry.leadId);

    if (entry.productSuggestion !== null) {
      const allowed = productAllowlistByLeadId.get(entry.leadId) ?? [];
      if (!allowed.includes(entry.productSuggestion)) return null; // invented product
    }
  }
  if (seenIds.size !== requestedIdSet.size) return null; // missing one or more requested leads

  return entries;
}
