import type { LeadClassification } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CLASSIFICATION_STYLES: Record<LeadClassification, string> = {
  HOT: "border-transparent bg-primary/15 text-primary",
  WARM: "border-transparent bg-amber-950/50 text-amber-400",
  COLD: "border-transparent bg-sky-950/50 text-sky-400",
};

/**
 * Renders a classification pill. `classification: null` represents a lead
 * that has never been scored — shown as an explicit "Not scored" badge
 * rather than being lumped in with COLD.
 */
export function ClassificationBadge({
  classification,
  className,
}: {
  classification: LeadClassification | null;
  className?: string;
}) {
  if (!classification) {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        Not scored
      </Badge>
    );
  }

  return (
    <Badge className={cn(CLASSIFICATION_STYLES[classification], className)}>
      {classification}
    </Badge>
  );
}
