import type { MarketOpportunityClassification } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CLASSIFICATION_LABELS: Record<MarketOpportunityClassification, string> = {
  HIGH_OPPORTUNITY: "High Opportunity",
  MEDIUM_OPPORTUNITY: "Medium Opportunity",
  EMERGING: "Emerging",
  INSUFFICIENT_DATA: "Insufficient Data",
};

/**
 * Styled per-tier, mirroring PriorityBadge/ClassificationBadge's per-value
 * Record pattern. INSUFFICIENT_DATA is deliberately styled as neutral/muted
 * (plain outline, same treatment "not scored" gets elsewhere) rather than a
 * weak/bad tint — it means "we don't know yet," not "this is a bad market."
 */
const CLASSIFICATION_STYLES: Record<MarketOpportunityClassification, string> = {
  HIGH_OPPORTUNITY: "border-transparent bg-primary/15 text-primary",
  MEDIUM_OPPORTUNITY: "border-transparent bg-emberBright/15 text-emberBright",
  EMERGING: "border-transparent bg-sky-950/50 text-sky-400",
  INSUFFICIENT_DATA: "border-border text-muted-foreground bg-muted/50",
};

export function ClassificationLabel({
  classification,
  className,
}: {
  classification: MarketOpportunityClassification;
  className?: string;
}) {
  return (
    <Badge
      variant={classification === "INSUFFICIENT_DATA" ? "outline" : "default"}
      className={cn(CLASSIFICATION_STYLES[classification], className)}
    >
      {CLASSIFICATION_LABELS[classification]}
    </Badge>
  );
}
