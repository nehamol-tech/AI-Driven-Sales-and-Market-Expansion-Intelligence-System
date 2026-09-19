import Link from "next/link";
import type { OpportunityDTO } from "@ai-sales/shared";
import { ClassificationBadge } from "@/components/leads/classification-badge";
import { MethodBadge } from "@/components/leads/method-badge";
import { PriorityBadge } from "@/components/sales-agent/priority-badge";
import { OpportunityTypeBadge } from "./opportunity-type-badge";
import { Button } from "@/components/ui/button";

/**
 * Renders one OpportunityDTO. Every field is either taken verbatim from the
 * API response or explicitly omitted, never fabricated. The "REAL SIGNALS"
 * block (evidence) and the narrative block are kept visually distinct — the
 * evidence is plain labeled data (mirrors ScorePanel's "Input data used"
 * <dl>), the narrative is a tinted box (mirrors ScorePanel's "Recommended
 * action" box) whose header text itself names the method (AI vs
 * rule-based), on top of the MethodBadge, so a RULE_BASED narrative can
 * never be mistaken for an AI insight.
 *
 * CROSS_SELL's productName is rendered as plain labeled text, never a link —
 * it refers to a real Product, not a lead, so linking it into
 * /leads/{leadType}/{id} would 404 or point at the wrong entity. This
 * mirrors the isRealLead guard in assistant/page.tsx's AssistantResultRow.
 */
export function OpportunityCard({ opportunity }: { opportunity: OpportunityDTO }) {
  const insightHeading =
    opportunity.narrativeMethod === "RULE_BASED" ? "Rule-based insight" : "AI insight";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <OpportunityTypeBadge type={opportunity.type} />
            <PriorityBadge priority={opportunity.priority} />
            <MethodBadge method={opportunity.narrativeMethod} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/leads/${opportunity.leadType}/${opportunity.leadId}`}
              className="font-medium hover:underline"
            >
              {opportunity.name}
            </Link>
            {opportunity.classification !== null && opportunity.score !== null ? (
              <>
                <ClassificationBadge classification={opportunity.classification} />
                <span className="text-sm text-muted-foreground">Score {opportunity.score}</span>
              </>
            ) : null}
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/leads/${opportunity.leadType}/${opportunity.leadId}`}>View Account</Link>
        </Button>
      </div>

      {opportunity.evidence.length > 0 ? (
        <div className="mt-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Real signals
          </h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {opportunity.evidence.map((item) => (
              <div key={item.label} className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="font-medium">{item.value}</dd>
              </div>
            ))}
            {opportunity.type === "CROSS_SELL" && opportunity.productName !== null ? (
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">Recommended product</dt>
                {/* productId/productName always refer to a real Product, never
                    a lead — plain text only, never a /leads/... link. */}
                <dd className="font-medium">{opportunity.productName}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
        <h4 className="mb-1 text-sm font-semibold">{insightHeading}</h4>
        {opportunity.narrative ? <p className="text-sm">{opportunity.narrative}</p> : null}
        <p className="mt-1 text-sm">
          <span className="font-medium">Recommended action: </span>
          {opportunity.recommendedAction}
        </p>
      </div>
    </div>
  );
}
