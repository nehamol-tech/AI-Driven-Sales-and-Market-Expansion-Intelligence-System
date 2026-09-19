import type { FollowUpStatus } from "@ai-sales/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<FollowUpStatus, string> = {
  PENDING: "border-transparent bg-sky-950/50 text-sky-400",
  COMPLETED: "border-transparent bg-emerald-950/50 text-emerald-400",
  CANCELLED: "border-transparent bg-secondary text-muted-foreground",
};

const STATUS_LABELS: Record<FollowUpStatus, string> = {
  PENDING: "Pending",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * Status pill for a follow-up. A PENDING follow-up whose `dueDate` has
 * already passed additionally renders a small "Overdue" cue — computed
 * client-side by comparing dueDate to `new Date()`, purely a display
 * nicety layered on top of the real `status` field. This never invents a
 * new data source: the server's own `dueBy=overdue` bucket is exactly
 * "PENDING and due in the past", so this is just that same rule applied
 * for display purposes on an already-fetched item.
 */
export function FollowUpStatusBadge({
  status,
  dueDate,
  className,
}: {
  status: FollowUpStatus;
  dueDate: string;
  className?: string;
}) {
  const isOverdue = status === "PENDING" && new Date(dueDate).getTime() < Date.now();

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Badge className={STATUS_STYLES[status]}>{STATUS_LABELS[status]}</Badge>
      {isOverdue ? <Badge variant="destructive">Overdue</Badge> : null}
    </span>
  );
}
