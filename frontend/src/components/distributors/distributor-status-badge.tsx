import type { DistributorStatus } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<DistributorStatus, string> = {
  PROSPECTIVE: "Prospective",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

/** Styled per-status, mirroring CampaignSourceBadge/ConnectionStatusBadge's per-value Record pattern. */
const STATUS_VARIANTS: Record<DistributorStatus, "success" | "secondary" | "outline"> = {
  PROSPECTIVE: "secondary",
  ACTIVE: "success",
  INACTIVE: "outline",
};

export function DistributorStatusBadge({ status }: { status: DistributorStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
