import { cn } from "@/lib/utils";

/**
 * Honest, plain score display. `score === null` (always and only
 * INSUFFICIENT_DATA) renders as "—" with no bar — never "0 / 100", which
 * would look like a real, low, measured value rather than "we don't know
 * yet." No decorative gauge/dial — a simple width-percentage bar is enough,
 * and never implies more precision than the backend's integer score has.
 */
export function MarketScore({
  score,
  size = "default",
  className,
}: {
  score: number | null;
  size?: "default" | "sm";
  className?: string;
}) {
  if (score === null) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span
          className={cn(
            "font-semibold text-muted-foreground",
            size === "sm" ? "text-base" : "text-2xl"
          )}
        >
          —
        </span>
        <span className="text-xs text-muted-foreground">Not enough data to score</span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <span className={cn("font-semibold tracking-tight", size === "sm" ? "text-base" : "text-2xl")}>
        {score} / 100
      </span>
      <div className="h-1.5 w-full max-w-[10rem] overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}
