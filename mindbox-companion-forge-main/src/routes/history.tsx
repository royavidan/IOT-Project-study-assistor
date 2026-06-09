import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { mockSessions, dailyAggregates, computeStreak } from "@/lib/mock-data";
import { Info } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Session History — MindBox" }] }),
  component: History,
});

function isoDaysAgo(n: number) {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function statusClass(status: string) {
  switch (status) {
    case "completed":   return "bg-success/10 text-success";
    case "interrupted": return "bg-warning-muted text-warning-foreground";
    default:            return "bg-danger-muted text-danger";
  }
}

function History() {
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo]     = useState(isoDaysAgo(0));

  const filtered = useMemo(
    () => mockSessions.filter((s) => s.date >= from && s.date <= to),
    [from, to],
  );
  const daily = useMemo(() => dailyAggregates(from, to), [from, to]);
  const totalMin = filtered.reduce((sum, s) => sum + s.durationMin, 0);
  const hours = (totalMin / 60).toFixed(1);
  const streak = computeStreak();

  const chartData = daily.map((d) => ({
    day: d.date.slice(5), // MM-DD
    minutes: d.minutes,
    score: d.avgScore,
  }));

  return (
    <TooltipProvider delayDuration={200}>
      <PageHeader
        title="Session history"
        description="Every focus session, logged from your device."
      />

      {/* Filter */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Total focused</p>
            <p className="text-2xl font-semibold tabular-nums">{hours}<span className="text-sm font-normal text-muted-foreground"> h</span></p>
          </div>
        </CardContent>
      </Card>

      {/* Streak callout */}
      <p className="mb-4 text-xs text-muted-foreground">
        Streak: <span className="font-medium text-foreground">{streak} day{streak === 1 ? "" : "s"}</span>.
        If no session is logged within 24 hours, the streak resets to zero.
      </p>

      {/* Daily bar chart */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Focus minutes by day</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                <RTooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="minutes" fill="var(--color-work)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Focus Load Estimate */}
      <Card className="mb-6">
        <CardHeader className="flex-row items-center gap-2">
          <CardTitle className="text-base">Focus Load Estimate (heuristic)</CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <button aria-label="About Focus Load Estimate" className="text-muted-foreground hover:text-foreground">
                <Info className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-left">
              This is a heuristic estimate based on session length and observed attention patterns.
              It is not a validated scientific measurement and should not be used as a clinical or
              cognitive assessment.
            </TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                <RTooltip
                  contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="var(--color-sync)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Score range 0–100. Heuristic only — not a validated scientific measurement.
          </p>
        </CardContent>
      </Card>

      {/* Session list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sessions ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {filtered.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No sessions in this range.</p>
          )}
          {filtered.map((s) => (
            <div key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.subject} · <span className="text-muted-foreground font-normal">{s.mode}</span></p>
                <p className="text-xs text-muted-foreground">
                  {s.date} · {s.start} · {s.durationMin} min · {s.breaks} break{s.breaks === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusClass(s.status)}`}>
                  {s.status}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                  {s.focusScore}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
