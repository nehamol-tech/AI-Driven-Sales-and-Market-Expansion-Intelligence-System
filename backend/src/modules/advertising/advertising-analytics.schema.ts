import { z } from "zod";

/** Exactly one derived summary per company — mirrors revenueAnalyticsQuerySchema's exact shape. */
export const advertisingAnalyticsQuerySchema = z.object({
  force: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false" as const),
});
export type AdvertisingAnalyticsQuery = z.infer<typeof advertisingAnalyticsQuerySchema>;

/**
 * Strict schema for the AI's single narrative response. Deliberately has NO
 * field for any number/name — those are never trusted from the model.
 * `z.object()` (not `.strict()`) is used deliberately, mirroring
 * revenue-analytics.schema.ts: any extra field the model includes is
 * silently stripped by zod's default behavior rather than rejected.
 */
export const aiAdvertisingNarrativeSchema = z.object({
  narrative: z.string().trim().min(1).max(800),
});
export type AIAdvertisingNarrative = z.infer<typeof aiAdvertisingNarrativeSchema>;

/**
 * Parses raw AI completion text as a JSON object and validates it against
 * aiAdvertisingNarrativeSchema. Never throws — returns null on any failure
 * so the caller can retry or fall back to the RULE_BASED template.
 */
export function parseAIAdvertisingNarrative(rawContent: string): AIAdvertisingNarrative | null {
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

  const result = aiAdvertisingNarrativeSchema.safeParse(parsedJson);
  if (!result.success) return null;
  return result.data;
}
