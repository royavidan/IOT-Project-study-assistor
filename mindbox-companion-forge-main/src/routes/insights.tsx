import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import {
  EnvFocusScatterChart,
  HourlyHeatmapGrid,
  TimeOfDayHeatmapChart,
  WeeklyTrendChart,
} from "@/features/insights/components/InsightsCharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StudentScopePicker } from "@/components/StudentScopePicker";
import { WellbeingPanel } from "@/features/insights/components/WellbeingPanel";
import { InfoHint } from "@/components/InfoHint";
import { useSessionScope } from "@/hooks/use-session-scope";
import { dateKeyDaysAgo } from "@/lib/dates";
import {
  computeEnvScatterPoints,
  computeHourlyHeatmap,
  computeSessionInsights,
  countSessionsWithEnv,
} from "@/features/insights/insights";
import { computeWellbeing } from "@/lib/wellbeing";
import { useExternalLoads } from "@/features/insights/external-load";
import { dailyAggregates } from "@/lib/queries/sessions";
import { Lightbulb } from "lucide-react";

export const Route = createFileRoute("/insights")({
  validateSearch: z.object({
    student: z.string().uuid().optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  head: () => ({ meta: [{ title: "Insights — MindBox" }] }),
  component: Insights,
});

function fmtCorr(r: number | null): string {
  if (r == null) return "—";
  const sign = r > 0 ? "+" : "";
  return `${sign}${r.toFixed(2)}`;
}

function Insights() {
  const navigate = useNavigate({ from: "/insights" });
  const { student: studentParam, from: fromParam, to: toParam } = Route.useSearch();
  const { students, viewingStudent, isReviewerView, scopedSessions, sessionsQuery } =
    useSessionScope(studentParam);

  const [from, setFrom] = useState(() => fromParam ?? dateKeyDaysAgo(29));
  const [to, setTo] = useState(() => toParam ?? dateKeyDaysAgo(0));

  const filtered = useMemo(
    () => scopedSessions.filter((s) => s.date >= from && s.date <= to),
    [scopedSessions, from, to],
  );

  const insights = useMemo(() => computeSessionInsights(filtered), [filtered]);
  const scatterPoints = useMemo(() => computeEnvScatterPoints(filtered), [filtered]);
  const hourlyHeat = useMemo(() => computeHourlyHeatmap(filtered), [filtered]);
  const weeklyTrend = useMemo(() => dailyAggregates(filtered, from, to), [filtered, from, to]);
  const envCount = useMemo(() => countSessionsWithEnv(filtered), [filtered]);
  const externalLoads = useExternalLoads();
  // External commitments are the viewer's own config, so only apply them when
  // looking at your own data (not a student you're reviewing).
  const wellbeing = useMemo(
    () => computeWellbeing(filtered, isReviewerView ? [] : (externalLoads.data ?? [])),
    [filtered, isReviewerView, externalLoads.data],
  );

  const onStudentChange = (value: string) => {
    if (value === "mine") {
      navigate({ search: { from, to, student: undefined }, replace: true });
    } else {
      navigate({ search: { from, to, student: value }, replace: true });
    }
  };

  const syncDatesToUrl = (nextFrom: string, nextTo: string) => {
    navigate({
      search: {
        from: nextFrom,
        to: nextTo,
        student: studentParam,
      },
      replace: true,
    });
  };

  if (sessionsQuery.isLoading) return <LoadingState label="Analyzing your sessions…" />;
  if (sessionsQuery.isError) {
    return (
      <ErrorState
        title="Could not load insights"
        description={sessionsQuery.error instanceof Error ? sessionsQuery.error.message : undefined}
        onRetry={() => void sessionsQuery.refetch()}
      />
    );
  }

  const hasEnoughForCharts = filtered.length >= 3 && envCount >= 3;

  return (
    <>
      <PageHeader
        title={isReviewerView ? "Student insights" : "Insights"}
        description={
          isReviewerView
            ? `Patterns for ${viewingStudent?.displayName ?? "student"} (read-only).`
            : "Cross-session patterns to help you find your ideal workspace."
        }
        actions={
          <Link
            to="/history"
            search={{ from, to, ...(studentParam ? { student: studentParam } : {}) }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View session list →
          </Link>
        }
      />

      <StudentScopePicker
        students={students}
        value={studentParam ?? "mine"}
        onChange={onStudentChange}
        isReviewerView={isReviewerView}
        studentName={viewingStudent?.displayName}
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="grid w-full gap-1.5 sm:w-auto">
            <Label htmlFor="ins-from">From</Label>
            <Input
              id="ins-from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                syncDatesToUrl(e.target.value, to);
              }}
              className="w-full sm:w-[160px]"
            />
          </div>
          <div className="grid w-full gap-1.5 sm:w-auto">
            <Label htmlFor="ins-to">To</Label>
            <Input
              id="ins-to"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                syncDatesToUrl(from, e.target.value);
              }}
              className="w-full sm:w-[160px]"
            />
          </div>
          <p className="text-sm text-muted-foreground sm:ml-auto">
            {filtered.length} session{filtered.length === 1 ? "" : "s"} · {envCount} with env data
          </p>
        </CardContent>
      </Card>

      {wellbeing.ready && <WellbeingPanel report={wellbeing} />}

      {!hasEnoughForCharts ? (
        <Card>
          <CardContent className="space-y-2 p-8 text-center text-sm text-muted-foreground">
            <p>
              Log at least <strong className="text-foreground">3 sessions</strong> with environment
              readings (noise, temperature, light) to unlock charts and correlations.
            </p>
            <p>
              You have {filtered.length} session{filtered.length === 1 ? "" : "s"} and {envCount}{" "}
              with env data in this range.
            </p>
            {!isReviewerView && (
              <Link to="/simulator" className="inline-block text-sync hover:underline">
                Log a session with sensors in the simulator →
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {insights.idealConditions && (
            <Card className="mb-6 border-work/20 bg-work-muted/30">
              <CardHeader className="flex-row items-center gap-2">
                <Lightbulb className="h-4 w-4 text-work" aria-hidden />
                <CardTitle className="text-base">Ideal workspace conditions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{insights.idealConditions.summary}</p>
                <p className="text-muted-foreground">
                  Based on your top {insights.idealConditions.sessionCount} session
                  {insights.idealConditions.sessionCount === 1 ? "" : "s"} (avg Focus Load Est.{" "}
                  {insights.idealConditions.avgFocusScore}).
                </p>
              </CardContent>
            </Card>
          )}

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Weekly focus trend</CardTitle>
              </CardHeader>
              <CardContent>
                <WeeklyTrendChart data={weeklyTrend} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Noise vs Focus Load Estimate</CardTitle>
              </CardHeader>
              <CardContent>
                <EnvFocusScatterChart points={scatterPoints} />
              </CardContent>
            </Card>
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Best time of day</CardTitle>
              </CardHeader>
              <CardContent>
                {insights.bestTimeSlot && (
                  <p className="mb-3 text-sm text-muted-foreground">
                    Highest average in{" "}
                    <span className="font-medium text-foreground">
                      {insights.bestTimeSlot.label}
                    </span>{" "}
                    ({insights.bestTimeSlot.avgFocusScore} across {insights.bestTimeSlot.sessions}{" "}
                    session{insights.bestTimeSlot.sessions === 1 ? "" : "s"}).
                  </p>
                )}
                <TimeOfDayHeatmapChart slots={insights.timeOfDay} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Hourly focus heatmap</CardTitle>
              </CardHeader>
              <CardContent>
                <HourlyHeatmapGrid cells={hourlyHeat} />
              </CardContent>
            </Card>
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center gap-2">
                <CardTitle className="text-base">Environment ↔ focus</CardTitle>
                <InfoHint label="About correlations">
                  Pearson correlation between each environment metric and your Focus Load Estimate
                  (heuristic, not clinical). Values near +1 / −1 suggest a stronger pattern.
                </InfoHint>
              </CardHeader>
              <CardContent className="space-y-3">
                {insights.envCorrelations.map((c) => (
                  <div key={c.metric}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{c.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {fmtCorr(c.correlation)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{c.interpretation}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">By mode & completion</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="divide-y divide-border">
                  {insights.modeBreakdown.map((row) => (
                    <div
                      key={row.mode}
                      className="flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0"
                    >
                      <span>{row.mode}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {row.count} · avg {row.avgFocusScore} · {row.totalMinutes} min
                      </span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                  {insights.statusBreakdown.map((row) => (
                    <div key={row.status} className="flex items-center gap-3 text-sm">
                      <span className="w-24 capitalize">{row.status}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-sync"
                          style={{ width: `${row.pct}%` }}
                        />
                      </div>
                      <span className="w-12 text-right tabular-nums text-muted-foreground">
                        {row.pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground">
            Focus Load Estimate is a transparent heuristic (0–100), not a validated scientific
            measurement.
          </p>
        </>
      )}
    </>
  );
}
