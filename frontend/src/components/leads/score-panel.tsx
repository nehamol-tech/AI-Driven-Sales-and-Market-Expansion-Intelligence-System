import type { LeadScoreDTO } from "@ai-sales/shared";
import { ClassificationBadge } from "./classification-badge";
import { MethodBadge } from "./method-badge";
import { ReasonList } from "./reason-list";
import { formatDate } from "@/lib/utils";

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatFeatureValue(value: number | string | boolean | null | undefined): string {
  // The live backend can send `null` for a feature that has no real value yet
  // (e.g. recencyDays for a lead with no orders) — render that as "—", never
  // as the literal string "null".
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Full score detail: number + classification + method, the AI narrative
 * (reasons + recommended action), and the real computed inputs kept
 * visually distinct from the narrative so it's clear what's data vs. AI text. */
export function ScorePanel({ score }: { score: LeadScoreDTO }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-4xl font-bold tracking-tight">{score.score}</span>
        <ClassificationBadge classification={score.classification} />
        <MethodBadge method={score.method} />
      </div>
      <p className="text-xs text-muted-foreground">
        Scored {formatDate(score.createdAt)} · provider: {score.provider}
        {score.modelName ? ` (${score.modelName})` : ""}
      </p>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Why this score</h4>
        <ReasonList reasons={score.reasons} />
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3">
        <h4 className="mb-1 text-sm font-semibold">Recommended action</h4>
        <p className="text-sm">{score.recommendedAction.action}</p>
        <p className="mt-1 text-xs text-muted-foreground">{score.recommendedAction.rationale}</p>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Input data used</h4>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {Object.entries(score.inputFeatures).map(([key, value]) => (
            <div key={key} className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{humanizeKey(key)}</dt>
              <dd className="font-medium">{formatFeatureValue(value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
