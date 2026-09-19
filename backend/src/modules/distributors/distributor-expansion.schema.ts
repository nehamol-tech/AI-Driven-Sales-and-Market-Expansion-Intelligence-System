import { z } from "zod";

/**
 * Strict schema for the AI's single narrative response. Deliberately has NO
 * field for any number/state/distributor name — those are never trusted
 * from the model. `z.object()` (not `.strict()`) is used deliberately,
 * mirroring advertising-analytics.schema.ts: any extra field the model
 * includes is silently stripped by zod's default behavior rather than
 * rejected.
 */
export const aiDistributorExpansionNarrativeSchema = z.object({
  narrative: z.string().trim().min(1).max(800),
});
export type AIDistributorExpansionNarrative = z.infer<typeof aiDistributorExpansionNarrativeSchema>;

/**
 * Parses raw AI completion text as a JSON object and validates it against
 * aiDistributorExpansionNarrativeSchema. Never throws — returns null on any
 * failure so the caller can retry or fall back to the RULE_BASED template.
 */
export function parseAIDistributorExpansionNarrative(rawContent: string): AIDistributorExpansionNarrative | null {
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

  const result = aiDistributorExpansionNarrativeSchema.safeParse(parsedJson);
  if (!result.success) return null;
  return result.data;
}
