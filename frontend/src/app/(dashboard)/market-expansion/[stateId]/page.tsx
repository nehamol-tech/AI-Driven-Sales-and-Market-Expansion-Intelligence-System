"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useMarketDetail } from "@/hooks/use-market-expansion";
import { ClassificationLabel } from "@/components/market-expansion/classification-label";
import { MarketScore } from "@/components/market-expansion/market-score";
import { MarketSignalsBreakdown } from "@/components/market-expansion/market-signals-breakdown";
import { MethodBadge } from "@/components/leads/method-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError } from "@/lib/api-client";
import { formatCurrency, formatNumber } from "@/lib/utils";

export default function MarketDetailPage() {
  const params = useParams<{ stateId: string }>();
  const stateId = params?.stateId;

  const { data: market, isLoading, isError, error, refetch } = useMarketDetail(stateId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !market) {
    return (
      <EmptyState
        title="Unable to load market expansion data."
        description={error instanceof ApiError ? error.message : "Please try again."}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  }

  const isInsufficient = market.classification === "INSUFFICIENT_DATA";
  const insightHeading = market.narrativeMethod === "RULE_BASED" ? "Rule-based insight" : "AI insight";

  return (
    <div className="space-y-6">
      <Link
        href="/market-expansion"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Market Expansion
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{market.stateName}</h1>
            <ClassificationLabel classification={market.classification} />
          </div>
          <MarketScore score={market.score} />
        </div>
      </div>

      {isInsufficient ? (
        <Card className="border-dashed">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {market.narrative ??
                `${market.stateName} has no real accounts, prospects, or orders on file yet, so there isn't enough internal data to assess it.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Score breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <MarketSignalsBreakdown subScores={market.subScores} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Real signals</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-y-3 text-sm">
                {market.evidence.map((item) => (
                  <div key={item.label} className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{item.label}</dt>
                    <dd className="font-medium">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          {market.narrative ? (
            <Card className="lg:col-span-3">
              <CardHeader className="flex flex-row items-center gap-2 space-y-0">
                <CardTitle className="text-base">{insightHeading}</CardTitle>
                <MethodBadge method={market.narrativeMethod} />
              </CardHeader>
              <CardContent>
                <p className="text-sm">{market.narrative}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Top industries</CardTitle>
            </CardHeader>
            <CardContent>
              {market.industrySignals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No real industry data on file for this state.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {market.industrySignals.map((industry) => (
                    <li key={industry.industryId} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="font-medium">{industry.industryName}</span>
                      <span className="text-muted-foreground">
                        {formatNumber(industry.accountCount)} accounts · {formatNumber(industry.orderCount)} orders ·{" "}
                        {formatCurrency(industry.totalValue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Top products</CardTitle>
            </CardHeader>
            <CardContent>
              {market.productSignals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No real product data on file for this state.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {market.productSignals.map((product) => (
                    <li key={product.productId} className="flex items-center justify-between gap-2 py-2 text-sm">
                      {/* productId/productName always refer to a real Product,
                          never a lead — plain text only, never a /leads/... link. */}
                      <span className="font-medium">{product.productName}</span>
                      <span className="text-muted-foreground">
                        {formatNumber(product.orderCount)} orders · {formatCurrency(product.totalValue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Cities</CardTitle>
            </CardHeader>
            <CardContent>
              {market.cityBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No real city-level data on file for this state.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {market.cityBreakdown.map((city) => (
                    <li key={city.cityId} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="font-medium">{city.cityName}</span>
                      <span className="text-muted-foreground">
                        {formatNumber(city.orderCount)} orders · {formatCurrency(city.totalValue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Growth signal</CardTitle>
            </CardHeader>
            <CardContent>
              {market.growthSignal.status === "ok" ? (
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span>
                    <span className="text-muted-foreground">Recent (last 60 days): </span>
                    <span className="font-medium">{formatCurrency(market.growthSignal.recentValue)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Prior 60 days: </span>
                    <span className="font-medium">{formatCurrency(market.growthSignal.priorValue)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Change: </span>
                    <span className="font-medium">
                      {market.growthSignal.growthPct >= 0 ? "+" : ""}
                      {(market.growthSignal.growthPct * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not enough order history yet to measure growth.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Potential expansion hypotheses</CardTitle>
            </CardHeader>
            <CardContent>
              {market.expansionHypotheses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No expansion hypotheses available for this state yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {market.expansionHypotheses.map((hypothesis, index) => (
                    <li
                      key={`${hypothesis.productId}-${index}`}
                      className="rounded-md border border-border bg-muted/30 p-3"
                    >
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Potential expansion hypothesis
                      </p>
                      <p className="text-sm">{hypothesis.statement}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {/* productName is a real Product, never a /leads/... link — same guard as OpportunityCard's CROSS_SELL row. */}
                        Based on {hypothesis.productName}&apos;s performance in {hypothesis.sourceStateName}
                        {hypothesis.targetIndustryName ? ` and fit with ${hypothesis.targetIndustryName}` : ""}.
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
