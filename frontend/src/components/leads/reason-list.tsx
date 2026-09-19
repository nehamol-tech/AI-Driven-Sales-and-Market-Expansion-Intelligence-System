import { CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import type { LeadScoreReason } from "@ai-sales/shared";
import { cn } from "@/lib/utils";

const SIGNAL_CONFIG: Record<
  LeadScoreReason["signal"],
  { icon: typeof CheckCircle2; className: string }
> = {
  positive: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  negative: { icon: XCircle, className: "text-red-600 dark:text-red-400" },
  neutral: { icon: MinusCircle, className: "text-muted-foreground" },
};

export function ReasonList({ reasons }: { reasons: LeadScoreReason[] }) {
  if (reasons.length === 0) {
    return <p className="text-sm text-muted-foreground">No reasons recorded for this score.</p>;
  }

  return (
    <ul className="space-y-2">
      {reasons.map((reason, i) => {
        const cfg = SIGNAL_CONFIG[reason.signal] ?? SIGNAL_CONFIG.neutral;
        const Icon = cfg.icon;
        return (
          <li key={`${reason.factor}-${i}`} className="flex gap-2 text-sm">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cfg.className)} />
            <div>
              <span className="font-medium">{reason.factor}</span>
              <p className="text-muted-foreground">{reason.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
