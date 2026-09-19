import type { ScoreMethod } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";

/**
 * Distinguishes a genuine AI-generated score from the transparent
 * rule-based fallback used when the AI call fails — never lets the
 * fallback be mistaken for an AI insight.
 */
export function MethodBadge({ method }: { method: ScoreMethod }) {
  return method === "AI" ? (
    <Badge variant="secondary">AI scored</Badge>
  ) : (
    <Badge variant="outline" title="The AI provider was unavailable; this score was computed with a transparent formula instead.">
      Rule-based estimate
    </Badge>
  );
}
