import Link from "next/link";
import type { MarketSummaryDTO } from "@ai-sales/shared";
import { ClassificationLabel } from "./classification-label";
import { MarketScore } from "./market-score";
import { MethodBadge } from "@/components/leads/method-badge";
import { Button } from "@/components/ui/button";

/**
 * One state's summary card for the /market-expansion list page. Mirrors
 * OpportunityCard's structure closely: real evidence in a labeled <dl>
 * ("Real signals"), then a visually distinct tinted insight box whose
 * heading itself names the narration method, so a RULE_BASED narrative can
 * never be mistaken for an AI insight. The "Explore Market" link always uses
 * the real `stateId` from the API, never a name-derived slug.
 */
export function MarketCard({ market }: { market: MarketSummaryDTO }) {
  const insightHeading = market.narrativeMethod === "RULE_BASED" ? "Rule-based insight" : "AI insight";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ClassificationLabel classification={market.classification} />
            <MethodBadge method={market.narrativeMethod} />
          </div>
          <Link href={`/market-expansion/${market.stateId}`} className="text-lg font-medium hover:underline">
            {market.stateName}
          </Link>
          <MarketScore score={market.score} size="sm" />
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/market-expansion/${market.stateId}`}>Explore Market</Link>
        </Button>
      </div>

      {market.evidence.length > 0 ? (
        <div className="mt-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Real signals
          </h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {market.evidence.map((item) => (
              <div key={item.label} className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="font-medium">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {market.narrative ? (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
          <h4 className="mb-1 text-sm font-semibold">{insightHeading}</h4>
          <p className="text-sm">{market.narrative}</p>
        </div>
      ) : null}
    </div>
  );
}
