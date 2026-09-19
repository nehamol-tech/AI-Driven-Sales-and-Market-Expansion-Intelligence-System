"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LineChart as LineChartIcon } from "lucide-react";
import type { RevenueMonthPoint } from "@ai-sales/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/utils";
import "@/styles/chart-theme.css";

interface ChartPoint {
  monthKey: string;
  actual?: number;
  projected?: number;
}

/**
 * Turns the DTO's flat actual+projected series into two parallel keys so
 * recharts can render them as visually distinct lines. The last actual point
 * is duplicated onto the projected key so the dashed forecast line starts
 * exactly where the solid actual line ends, instead of leaving a visible gap.
 */
function toChartData(series: RevenueMonthPoint[]): ChartPoint[] {
  const data: ChartPoint[] = series.map((point) => ({
    monthKey: point.monthKey,
    actual: point.kind === "actual" ? Number(point.revenue) : undefined,
    projected: point.kind === "projected" ? Number(point.revenue) : undefined,
  }));

  let lastActualIndex = -1;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i].actual !== undefined) lastActualIndex = i;
  }
  if (lastActualIndex !== -1) {
    data[lastActualIndex] = { ...data[lastActualIndex], projected: data[lastActualIndex].actual };
  }

  return data;
}

function formatMonthTick(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  if (!year || !month) return monthKey;
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return monthKey;
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(date);
}

/**
 * Real months (solid line) vs. projected/forecast months (dashed line) —
 * kept as two series so the visual distinction survives at a glance, never
 * blending a forecast into what looks like real history.
 */
export function RevenueTrendChart({ series }: { series: RevenueMonthPoint[] }) {
  if (series.length === 0) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="No revenue history yet"
        description="Log sales records to start building a revenue trend."
      />
    );
  }

  const data = toChartData(series);
  const hasProjected = series.some((point) => point.kind === "projected");

  return (
    <div className="viz-root h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--gridline)" vertical={false} />
          <XAxis
            dataKey="monthKey"
            tickFormatter={formatMonthTick}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
          />
          <YAxis
            tickFormatter={(v: number) => formatCurrency(v)}
            tickLine={false}
            axisLine={false}
            width={90}
            tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              formatCurrency(value),
              name === "actual" ? "Actual" : "Projected",
            ]}
            labelFormatter={(label: string) => formatMonthTick(label)}
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              fontSize: 12,
              color: "hsl(var(--popover-foreground))",
            }}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
          />
          {hasProjected ? (
            <Line
              type="monotone"
              dataKey="projected"
              stroke="var(--series-2)"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 3 }}
              connectNulls={false}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
