import Link from "next/link";
import type { SalesAgentPriorityDTO } from "@ai-sales/shared";
import { ClassificationBadge } from "@/components/leads/classification-badge";
import { MethodBadge } from "@/components/leads/method-badge";
import { PriorityBadge } from "@/components/sales-agent/priority-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Renders one SalesAgentPriorityDTO. Reused as-is by both the dashboard's
 * "Today's Priorities" section (sliced to 5) and the full /sales-agent
 * page (all returned items) — every field is either taken verbatim from
 * the API response or omitted, never fabricated.
 */
export function PriorityCard({
  priority,
  compact = false,
}: {
  priority: SalesAgentPriorityDTO;
  compact?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", compact ? "p-3" : "p-4")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{priority.name}</span>
            <Badge variant="outline" className="text-muted-foreground">
              {priority.leadType === "accounts" ? "Account" : "Prospect"}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ClassificationBadge classification={priority.classification} />
            <PriorityBadge priority={priority.priority} />
            <MethodBadge method={priority.narrativeMethod} />
            <span className="text-sm text-muted-foreground">Score {priority.score}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/leads/${priority.leadType}/${priority.leadId}`}>View Lead</Link>
        </Button>
      </div>

      {priority.reasons.length > 0 ? (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          {priority.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-sm">
        <span className="font-medium">Recommended action: </span>
        {priority.recommendedAction}
      </p>

      {priority.productSuggestion ? (
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Product suggestion: </span>
          {priority.productSuggestion}
        </p>
      ) : null}
    </div>
  );
}
