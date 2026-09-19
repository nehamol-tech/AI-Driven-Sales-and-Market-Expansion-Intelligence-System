import type { LeadScoreDTO } from "@ai-sales/shared";
import { ClassificationBadge } from "./classification-badge";
import { MethodBadge } from "./method-badge";
import { formatDate } from "@/lib/utils";

/** Newest-first timeline of every score this lead has ever received. */
export function ScoreHistory({ history }: { history: LeadScoreDTO[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No score history yet.</p>;
  }

  return (
    <ol className="space-y-4 border-l border-border pl-4">
      {history.map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-border" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{entry.score}</span>
            <ClassificationBadge classification={entry.classification} />
            <MethodBadge method={entry.method} />
            <span className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
