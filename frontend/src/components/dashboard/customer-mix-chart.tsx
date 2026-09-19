"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { DashboardOverviewDTO } from "@ai-sales/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/utils";
import { PieChart } from "lucide-react";
import "@/styles/chart-theme.css";

/**
 * The dashboard overview contract (DashboardOverviewDTO) doesn't expose a
 * sales-over-time series, so a literal "sales over time" line chart would
 * have nothing real to plot. Instead this renders the one genuinely
 * real, chart-worthy comparison the DTO does provide: new vs. returning
 * customers, derived from totalCustomers/newCustomers. If either metric is
 * insufficient_data, no chart is fabricated — an explicit empty state shows
 * instead.
 */
export function CustomerMixChart({
  totalCustomers,
  newCustomers,
}: {
  totalCustomers: DashboardOverviewDTO["totalCustomers"];
  newCustomers: DashboardOverviewDTO["newCustomers"];
}) {
  if (totalCustomers.status !== "ok" || newCustomers.status !== "ok") {
    return (
      <EmptyState
        icon={PieChart}
        title="Insufficient data yet"
        description="Log a few sales records with customer names to see your new-vs-returning customer mix."
      />
    );
  }

  const total = totalCustomers.value;
  const fresh = Math.min(newCustomers.value, total);
  const returning = Math.max(total - fresh, 0);

  const data = [
    { name: "New customers", value: fresh, slot: "series-1" },
    { name: "Returning customers", value: returning, slot: "series-2" },
  ];

  return (
    <div className="viz-root h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
          />
          <Bar dataKey="value" radius={[4, 4, 4, 4]} barSize={28}>
            {data.map((entry) => (
              <Cell
                key={entry.slot}
                fill={entry.slot === "series-1" ? "var(--series-1)" : "var(--series-2)"}
              />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value: number) => formatNumber(value)}
              fill="var(--text-secondary)"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
