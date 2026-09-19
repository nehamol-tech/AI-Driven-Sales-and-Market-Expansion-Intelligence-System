import * as React from "react";
import type { MetricValue } from "@ai-sales/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps<T> {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  metric: MetricValue<T> | undefined;
  format: (value: T) => React.ReactNode;
  isLoading?: boolean;
  hint?: string;
  className?: string;
}

export function MetricCard<T>({
  label,
  icon: Icon,
  metric,
  format,
  isLoading,
  hint,
  className,
}: MetricCardProps<T>) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        ) : metric?.status === "ok" ? (
          <div className="text-3xl font-semibold tracking-tight">
            {format(metric.value)}
          </div>
        ) : (
          <div>
            <div className="text-lg font-medium text-muted-foreground">
              Insufficient data yet
            </div>
            {hint ? (
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
