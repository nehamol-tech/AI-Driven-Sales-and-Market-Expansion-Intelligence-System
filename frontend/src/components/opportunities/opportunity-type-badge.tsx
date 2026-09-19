import type { OpportunityType } from "@ai-sales/shared";
import {
  RotateCcw,
  TrendingDown,
  ShoppingCart,
  Gem,
  RefreshCw,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const OPPORTUNITY_TYPE_META: Record<OpportunityType, { label: string; icon: LucideIcon; className: string }> = {
  REORDER: {
    label: "Reorder",
    icon: RotateCcw,
    className: "border-transparent bg-sky-950/50 text-sky-400",
  },
  AT_RISK: {
    label: "At Risk",
    icon: TrendingDown,
    className: "border-transparent bg-destructive/15 text-destructive",
  },
  CROSS_SELL: {
    label: "Cross-Sell",
    icon: ShoppingCart,
    className: "border-transparent bg-violet-950/50 text-violet-400",
  },
  HIGH_VALUE: {
    label: "High Value",
    icon: Gem,
    className: "border-transparent bg-primary/15 text-primary",
  },
  REACTIVATION: {
    label: "Reactivation",
    icon: RefreshCw,
    className: "border-transparent bg-amber-950/50 text-amber-400",
  },
  GROWING_ACCOUNT: {
    label: "Growing",
    icon: TrendingUp,
    className: "border-transparent bg-emberBright/15 text-emberBright",
  },
};

/**
 * Renders the opportunity type pill with a distinct icon per type, mirroring
 * PriorityBadge's structure/styling approach (a Record of per-value styles
 * rendered through the shared Badge primitive).
 */
export function OpportunityTypeBadge({
  type,
  className,
}: {
  type: OpportunityType;
  className?: string;
}) {
  const meta = OPPORTUNITY_TYPE_META[type];
  const Icon = meta.icon;
  return (
    <Badge className={cn("gap-1", meta.className, className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}
