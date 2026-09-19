import { z } from "zod";

/**
 * Strict schema for the AI provider's lead-scoring JSON response. The AI is
 * only ever asked for score + reasons + recommendedAction — classification
 * is deliberately not part of this schema since it's always derived in code
 * from the validated score, never trusted from the model.
 */
export const aiScoreReasonSchema = z.object({
  factor: z.string().trim().min(1).max(200),
  signal: z.enum(["positive", "negative", "neutral"]),
  detail: z.string().trim().min(1).max(1000),
});

export const aiScoreResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasons: z.array(aiScoreReasonSchema).min(3).max(6),
  recommendedAction: z.object({
    action: z.string().trim().min(1).max(300),
    rationale: z.string().trim().min(1).max(1000),
  }),
});

export type AIScoreResponse = z.infer<typeof aiScoreResponseSchema>;

/**
 * Parses raw AI completion text as JSON and validates it against
 * `aiScoreResponseSchema`. Returns null (never throws) on any failure —
 * malformed/non-conforming output is rejected, not coerced, so the caller
 * can retry or fall back to the rule-based method.
 */
export function parseAIScoreResponse(rawContent: string): AIScoreResponse | null {
  let parsedJson: unknown;
  try {
    // The prompt asks for JSON only, but strip accidental markdown fencing
    // defensively in case a provider ignores the instruction.
    const cleaned = rawContent
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    parsedJson = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const result = aiScoreResponseSchema.safeParse(parsedJson);
  return result.success ? result.data : null;
}
