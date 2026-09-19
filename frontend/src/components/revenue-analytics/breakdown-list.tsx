import type { RevenueBreakdownItem } from "@ai-sales/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";

/**
 * One ranked breakdown list (state/industry/product/salesperson), reused 4x
 * on the revenue analytics page. Items arrive already ranked/bounded from
 * the backend — this never re-sorts. An empty array renders a plain "no
 * data yet" message inside the card rather than hiding the card.
 */
export function BreakdownList({
  title,
  items,
  emptyHint,
}: {
  title: string;
  items: RevenueBreakdownItem[];
  emptyHint: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li key={item.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-4 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
                  <span className="truncate text-sm font-medium" title={item.name}>
                    {item.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-baseline gap-2 text-right">
                  <span className="text-sm font-medium">{formatCurrency(item.totalValue)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatNumber(item.orderCount)} orders
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
