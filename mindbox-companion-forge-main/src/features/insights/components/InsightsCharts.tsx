import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type { DailyAggregate } from "@/lib/types";
import type { EnvScatterPoint, HourlyHeatCell, TimeOfDaySlot } from "@/features/insights/insights";

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

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
    score: d.avgScore,
    sessions: d.sessions,
  }));

  if (chartData.every((d) => d.sessions === 0)) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No sessions in this range.</p>
    );
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="score"
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
          />
          <YAxis
            yAxisId="min"
            orientation="right"
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
            hide
          />
          <RTooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => {
              if (name === "score") return [`${value}`, "Avg Focus Load Est."];
              if (name === "minutes") return [`${value} min`, "Focus time"];
              return [value, name];
            }}
          />
          <Line
            yAxisId="score"
            type="monotone"
            dataKey="score"
            stroke="var(--color-sync)"
            strokeWidth={2}
            dot={{ r: 2 }}
            name="score"
          />
          <Line
            yAxisId="min"
            type="monotone"
            dataKey="minutes"
            stroke="var(--color-work)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            name="minutes"
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-xs text-muted-foreground">
        Solid line: avg Focus Load Estimate · dashed: focus minutes per day
      </p>
    </div>
  );
}

export function EnvFocusScatterChart({ points }: { points: EnvScatterPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Need at least two sessions with noise readings.
      </p>
    );
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            type="number"
            dataKey="noise"
            name="Noise"
            domain={[0, 1]}
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
            label={{ value: "Noise (0–1)", position: "insideBottom", offset: -2, fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="focusScore"
            name="Focus"
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
            label={{
              value: "Focus Load Est.",
              angle: -90,
              position: "insideLeft",
              fontSize: 11,
            }}
          />
          <ZAxis range={[40, 40]} />
          <RTooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={tooltipStyle}
            formatter={(value, name) => {
              if (name === "Noise") return [value, "Noise"];
              if (name === "Focus") return [value, "Focus Load Est."];
              return [value, name];
            }}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.label ? String(payload[0].payload.label) : ""
            }
          />
          <Scatter data={points} fill="var(--color-sync)" fillOpacity={0.85} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TimeOfDayHeatmapChart({ slots }: { slots: TimeOfDaySlot[] }) {
  if (slots.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No time-of-day data yet.</p>
    );
  }

  const maxScore = Math.max(...slots.map((s) => s.avgFocusScore), 1);
  const chartData = slots.map((s) => ({
    ...s,
    shortLabel: s.label.split(" (")[0],
    intensity: Math.round((s.avgFocusScore / maxScore) * 100),
  }));

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="shortLabel"
            tick={{ fontSize: 11 }}
            stroke="var(--color-muted-foreground)"
          />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
          <RTooltip
            cursor={{ fill: "var(--color-muted)" }}
            contentStyle={tooltipStyle}
            formatter={(value) => [`${value}`, "Avg Focus Load Est."]}
            labelFormatter={(label) => String(label)}
          />
          <Bar dataKey="avgFocusScore" radius={[4, 4, 0, 0]}>
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
                ? `${cell.label}: avg ${cell.avgFocusScore} (${cell.sessions} session${cell.sessions === 1 ? "" : "s"})`
                : `${cell.label}: no sessions`
            }
            className="aspect-square rounded-sm border border-border/50"
            style={{ background: heatColor(cell.intensity, cell.sessions > 0) }}
            aria-label={
              cell.sessions > 0
                ? `${cell.label}, average focus ${cell.avgFocusScore}`
                : `${cell.label}, no data`
            }
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>00:00 → 23:00 (darker green = higher avg Focus Load Est.)</span>
        <span>
          {active.length} active hour{active.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
