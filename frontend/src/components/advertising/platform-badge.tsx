import type { AdPlatform } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";

const PLATFORM_LABELS: Record<AdPlatform, string> = {
  META: "Meta",
  GOOGLE: "Google",
};

export function PlatformBadge({ platform }: { platform: AdPlatform }) {
  return <Badge variant="outline">{PLATFORM_LABELS[platform]}</Badge>;
}
