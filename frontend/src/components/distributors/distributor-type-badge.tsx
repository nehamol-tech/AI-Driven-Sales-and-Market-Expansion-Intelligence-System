import type { DistributorType } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";

const TYPE_LABELS: Record<DistributorType, string> = {
  DISTRIBUTOR: "Distributor",
  DEALER: "Dealer",
};

export function DistributorTypeBadge({ type }: { type: DistributorType }) {
  return <Badge variant="outline">{TYPE_LABELS[type]}</Badge>;
}
