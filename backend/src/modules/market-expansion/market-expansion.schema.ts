import { z } from "zod";

/** Caps how many top-ranked states get narrated via one batched AI call — cost control, mirrors Phase 3A/3C's DEFAULT_LIMIT/MAX_LIMIT pattern. */
export const MARKET_EXPANSION_DEFAULT_LIMIT = 10;
export const MARKET_EXPANSION_MAX_LIMIT = 20;

export const marketExpansionQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MARKET_EXPANSION_MAX_LIMIT).default(MARKET_EXPANSION_DEFAULT_LIMIT),
  force: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false" as const),
});
export type MarketExpansionQuery = z.infer<typeof marketExpansionQuerySchema>;

/** The detail-by-state route has no `limit` (it's always exactly one state) — only `force` is meaningful. */
export const marketExpansionForceQuerySchema = z.object({
  force: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false" as const),
});
export type MarketExpansionForceQuery = z.infer<typeof marketExpansionForceQuerySchema>;

export const stateIdParamSchema = z.object({
  stateId: z.string().trim().min(1),
});

/**
 * Strict schema for one entry of the AI's batched market-narration response.
 * Deliberately has NO field for score/classification/counts/values — those
 * are never trusted from the model. `z.object()` (not `.strict()`) is used
 * deliberately: any extra field the model includes is silently STRIPPED by
 * zod's default behavior rather than rejected — documented here as the
 * chosen behavior (mirrors opportunities.schema.ts) so there is structurally
 * nothing for the AI to override even if it tries.
 */
export const aiHypothesisStatementSchema = z.object({
  productId: z.string().trim().min(1),
  statement: z.string().trim().min(1).max(400),
});

export const aiMarketExpansionEntrySchema = z.object({
  stateId: z.string().trim().min(1),
  narrative: z.string().trim().min(1).max(800),
  hypothesisStatements: z.array(aiHypothesisStatementSchema).max(10).default([]),
});

export const aiMarketExpansionResponseSchema = z.array(aiMarketExpansionEntrySchema).min(1);

export type AIMarketExpansionEntry = z.infer<typeof aiMarketExpansionEntrySchema>;

/**
 * Parses raw AI completion text as a JSON array and validates it against
 * `aiMarketExpansionResponseSchema`, then enforces THREE additional real-data
 * invariants a JSON schema alone can't express:
 *
 *  1. A full bijection against `requestedStateIds` — exactly one entry per
 *     requested state, no invented stateIds, no duplicates, none missing.
 *  2. No duplicate productId within a single state's hypothesisStatements.
 *  3. Every `(stateId, productId)` hypothesis pairing the AI returns must be
 *     present in `hypothesisAllowlist` — the flat set of every REAL
 *     candidate pairing that was actually sent in the batch (built by the
 *     caller from expansion-signals.ts's real candidates). This is what
 *     actually prevents the AI from inventing a product/state pairing —
 *     enforced here at validation time, not just by prompt instruction. A
 *     flat `"stateId:productId"` string-set allowlist is used rather than a
 *     per-state bijection check, since a state may legitimately have zero,
 *     one, or two real candidates and the AI is allowed to omit any of them
 *     (only inventing one is disallowed) — documented choice.
 *
 * Any violation rejects the WHOLE batch (the caller falls back to
 * RULE_BASED for everything) rather than silently patching gaps, mirroring
 * opportunities.schema.ts's parseAIOpportunityResponse exactly.
 *
 * Never throws — returns null on any failure so the caller can retry or
 * fall back.
 */
export function parseAIMarketExpansionResponse(
  rawContent: string,
  requestedStateIds: string[],
  hypothesisAllowlist: Set<string>,
): AIMarketExpansionEntry[] | null {
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

  const result = aiMarketExpansionResponseSchema.safeParse(parsedJson);
  if (!result.success) return null;
  const entries = result.data;

  const requestedIdSet = new Set(requestedStateIds);
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (!requestedIdSet.has(entry.stateId)) return null; // invented stateId
    if (seenIds.has(entry.stateId)) return null; // duplicate
    seenIds.add(entry.stateId);

    const seenProductIds = new Set<string>();
    for (const h of entry.hypothesisStatements) {
      if (seenProductIds.has(h.productId)) return null; // duplicate hypothesis product for this state
      seenProductIds.add(h.productId);
      if (!hypothesisAllowlist.has(`${entry.stateId}:${h.productId}`)) return null; // invented product/state pairing
    }
  }
  if (seenIds.size !== requestedIdSet.size) return null; // missing one or more requested states

  return entries;
}
