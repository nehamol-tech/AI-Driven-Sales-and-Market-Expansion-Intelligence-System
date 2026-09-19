import type { AdConnectionStatus } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";

export function ConnectionStatusBadge({ status }: { status: AdConnectionStatus }) {
  if (status === "CONNECTED") return <Badge variant="success">Connected</Badge>;
  if (status === "ERROR") return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="outline">Disconnected</Badge>;
}
