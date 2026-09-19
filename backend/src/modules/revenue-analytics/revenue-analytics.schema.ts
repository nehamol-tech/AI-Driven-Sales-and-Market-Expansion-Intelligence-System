import { z } from "zod";

/**
 * This endpoint has no `limit` param, unlike market-expansion's list
 * endpoint — there is exactly one result per company (a single derived
 * analytics DTO), not a ranked list, so only `force` is meaningful. Mirrors
 * marketExpansionForceQuerySchema's exact shape.
 */
export const revenueAnalyticsQuerySchema = z.object({
  force: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false" as const),
});
export type RevenueAnalyticsQuery = z.infer<typeof revenueAnalyticsQuerySchema>;

/**
 * Strict schema for the AI's single narrative response. Deliberately has NO
 * field for any number/date/name — those are never trusted from the model.
 * `z.object()` (not `.strict()`) is used deliberately: any extra field the
 * model includes is silently STRIPPED by zod's default behavior rather than
 * rejected — documented here as the chosen behavior (mirrors
 * market-expansion.schema.ts / opportunities.schema.ts) so there is
 * structurally nothing for the AI to override even if it tries.
 */
export const aiRevenueNarrativeSchema = z.object({
  narrative: z.string().trim().min(1).max(800),
});
export type AIRevenueNarrative = z.infer<typeof aiRevenueNarrativeSchema>;

/**
 * Parses raw AI completion text as a JSON object and validates it against
 * `aiRevenueNarrativeSchema`. Unlike market-expansion's batched array
 * response, there is only one entity here (the company), so there is no
 * id-bijection or allowlist to enforce — just shape validation.
 *
 * Never throws — returns null on any failure so the caller can retry or
 * fall back to the RULE_BASED template.
 */
export function parseAIRevenueNarrative(rawContent: string): AIRevenueNarrative | null {
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

  const result = aiRevenueNarrativeSchema.safeParse(parsedJson);
  if (!result.success) return null;
  return result.data;
}
