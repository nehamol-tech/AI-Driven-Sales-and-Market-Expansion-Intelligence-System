import type { MarketSubScoresDTO } from "@ai-sales/shared";

const SUB_SCORE_LABELS: Record<keyof MarketSubScoresDTO, string> = {
  existingDemand: "Existing demand",
  customerQuality: "Customer quality",
  productFit: "Product fit",
  industryFit: "Industry fit",
  growth: "Growth",
  whitespace: "Whitespace",
};

const SUB_SCORE_KEYS = Object.keys(SUB_SCORE_LABELS) as (keyof MarketSubScoresDTO)[];

/**
 * Renders the 6 deterministic 0-100 sub-scores that compose `score` — always
 * displayed exactly as returned by the API, never recomputed or
 * re-weighted client-side.
 */
export function MarketSignalsBreakdown({ subScores }: { subScores: MarketSubScoresDTO }) {
  return (
    <div className="space-y-3">
      {SUB_SCORE_KEYS.map((key) => (
        <div key={key} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{SUB_SCORE_LABELS[key]}</span>
            <span className="font-medium">{subScores[key]} / 100</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${Math.max(0, Math.min(100, subScores[key]))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
