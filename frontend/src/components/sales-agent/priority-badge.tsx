import type { DailyPriorityLevel } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PRIORITY_STYLES: Record<DailyPriorityLevel, string> = {
  HIGH: "border-transparent bg-primary/15 text-primary",
  MEDIUM: "border-transparent bg-amber-950/50 text-amber-400",
  LOW: "border-transparent bg-secondary text-muted-foreground",
};

/**
 * Renders the deterministic HIGH/MEDIUM/LOW daily priority pill for a
 * SalesAgentPriorityDTO — visually distinct tiers, HIGH the most prominent,
 * mirroring ClassificationBadge's structure/styling approach.
 */
export function PriorityBadge({
  priority,
  className,
}: {
  priority: DailyPriorityLevel;
  className?: string;
}) {
  return (
    <Badge className={cn(PRIORITY_STYLES[priority], className)}>
      {priority}
    </Badge>
  );
}
