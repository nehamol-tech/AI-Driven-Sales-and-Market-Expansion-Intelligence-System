import type { PipelineFunnelStageDTO } from "@ai-sales/shared";
import { formatNumber } from "@/lib/utils";

function stageLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/**
 * All 8 pipeline stages (in PROSPECT_STATUSES order, as the DTO already
 * provides them) as a proportional bar list — real prospect counts per
 * stage, tying this page back to Phase 5's pipeline. Bar widths are relative
 * to the largest stage's count so the shape of the funnel reads at a glance.
 */
export function PipelineFunnel({ stages }: { stages: PipelineFunnelStageDTO[] }) {
  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  return (
    <ul className="space-y-2.5">
      {stages.map((stage) => {
        const widthPercent = Math.round((stage.count / maxCount) * 100);
        return (
          <li key={stage.status} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{stageLabel(stage.status)}</span>
              <span className="text-muted-foreground">{formatNumber(stage.count)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: stage.count > 0 ? `${widthPercent}%` : 0 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
