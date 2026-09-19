import type { AdCampaignSource } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";

const SOURCE_LABELS: Record<AdCampaignSource, string> = {
  MANUAL: "Manual",
  META_SYNC: "Meta sync",
  GOOGLE_SYNC: "Google sync",
};

/** Distinguishes a hand-entered campaign from one pulled in by a real platform sync. */
export function CampaignSourceBadge({ source }: { source: AdCampaignSource }) {
  return (
    <Badge variant={source === "MANUAL" ? "secondary" : "success"}>
      {SOURCE_LABELS[source]}
    </Badge>
  );
}
