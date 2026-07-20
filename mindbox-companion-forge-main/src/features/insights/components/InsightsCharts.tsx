import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DailyAggregate } from "@/lib/types";
import type { HourlyHeatCell, TimeOfDaySlot } from "@/features/insights/insights";

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

/** Green ramp — used for study-time density (more time = greener). */
function heatColor(intensity: number, hasData: boolean): string {
  if (!hasData) return "var(--color-muted)";
  if (intensity >= 75) return "var(--color-work)";
  if (intensity >= 50) return "color-mix(in oklab, var(--color-work) 65%, var(--color-muted))";
  if (intensity >= 25) return "color-mix(in oklab, var(--color-work) 35%, var(--color-muted))";
  return "color-mix(in oklab, var(--color-work) 15%, var(--color-muted))";
}

export function WeeklyTrendChart({ data }: { data: DailyAggregate[] }) {
  const chartData = data.map((d) => ({
    day: d.date.slice(5),
    minutes: d.minutes,
    load: d.avgScore,
    sessions: d.sessions,
  }));

  if (chartData.every((d) => d.sessions === 0)) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No sessions in this range.</p>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="min"
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
            label={{
              value: "minutes",
              angle: -90,
              position: "insideLeft",
              fontSize: 11,
              offset: 12,
            }}
          />
          <YAxis
            yAxisId="load"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
            label={{ value: "load", angle: 90, position: "insideRight", fontSize: 11 }}
          />
          <RTooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => {
              if (name === "Focus minutes") return [`${value} min`, name];
              if (name === "Focus Load") return [`${value}`, name];
              return [value, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            yAxisId="min"
            type="monotone"
            dataKey="minutes"
            stroke="var(--color-work)"
            strokeWidth={2}
            dot={{ r: 2 }}
            name="Focus minutes"
          />
          <Line
            yAxisId="load"
            type="monotone"
            dataKey="load"
            stroke="var(--color-warning)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            name="Focus Load"
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-muted-foreground">
        Focus minutes (left axis) vs Focus Load — a strain estimate, not a grade (right axis,
        0–100).
      </p>
    </div>
  );
}

export function TimeOfDayHeatmapChart({ slots }: { slots: TimeOfDaySlot[] }) {
  if (slots.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No time-of-day data yet.</p>
    );
  }

  const maxMin = Math.max(...slots.map((s) => s.totalMinutes), 1);
  const chartData = slots.map((s) => ({
    ...s,
    shortLabel: s.label.split(" (")[0],
    intensity: Math.round((s.totalMinutes / maxMin) * 100),
  }));

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="shortLabel"
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
            label={{
              value: "minutes",
              angle: -90,
              position: "insideLeft",
              fontSize: 11,
              offset: 12,
            }}
          />
          <RTooltip
            cursor={{ fill: "var(--color-muted)" }}
            contentStyle={tooltipStyle}
            formatter={(value) => [`${value} min`, "Focus time"]}
            labelFormatter={(label) => String(label)}
          />
          <Bar dataKey="totalMinutes" radius={[4, 4, 0, 0]}>
            {chartData.map((entry) => (
              <Cell key={entry.label} fill={heatColor(entry.intensity, entry.sessions > 0)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HourlyHeatmapGrid({ cells }: { cells: HourlyHeatCell[] }) {
  const active = cells.filter((c) => c.sessions > 0);

  return (
    <div>
      <div className="grid grid-cols-12 gap-1 sm:grid-cols-[repeat(24,minmax(0,1fr))]">
        {cells.map((cell) => (
          <div
            key={cell.hour}
            title={
              cell.sessions > 0
                ? `${cell.label}: ${cell.minutes} min (${cell.sessions} session${cell.sessions === 1 ? "" : "s"})`
                : `${cell.label}: no sessions`
            }
            className="aspect-square rounded-sm border border-border/50"
            style={{ background: heatColor(cell.intensity, cell.sessions > 0) }}
            aria-label={
              cell.sessions > 0
                ? `${cell.label}, ${cell.minutes} minutes studied`
                : `${cell.label}, no data`
            }
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          Less
          <span className="flex gap-0.5">
            {[15, 35, 65, 90].map((i) => (
              <span
                key={i}
                className="h-3 w-3 rounded-sm"
                style={{ background: heatColor(i, true) }}
              />
            ))}
          </span>
          more study time · 00:00 → 23:00
        </span>
        <span>
          {active.length} active hour{active.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
