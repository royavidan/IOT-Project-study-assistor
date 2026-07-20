import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { ErrorState, LoadingState } from "@/components/EmptyState";
import {
  HourlyHeatmapGrid,
  TimeOfDayHeatmapChart,
  WeeklyTrendChart,
} from "@/features/insights/components/InsightsCharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FocusBatteryCard } from "@/features/insights/components/FocusBatteryCard";
import { LoadReviewCard } from "@/features/insights/components/LoadReviewCard";
import { StudyConditionsCard } from "@/features/insights/components/StudyConditionsCard";
import { StudyTimeEffectCard } from "@/features/insights/components/StudyTimeEffectCard";
import { useSessionScope } from "@/hooks/use-session-scope";
import { dateKeyDaysAgo } from "@/lib/dates";
import {
  computeHourlyHeatmap,
  computeSessionInsights,
  countSessionsWithEnv,
} from "@/features/insights/insights";
import { computeWellbeing } from "@/lib/wellbeing";
import { useExternalLoads } from "@/features/insights/external-load";
import { externalLoadFromSchedule } from "@/features/insights/schedule-load";
import { useScheduleEvents } from "@/features/schedule/queries";
import { sumStrainMinutes } from "@/lib/study-strain";
import { dailyAggregates } from "@/lib/queries/sessions";

interface Props {
  student?: string;
  initialFrom?: string;
  initialTo?: string;
}

export function InsightsView({ student, initialFrom, initialTo }: Props) {
  const { isReviewerView, scopedSessions, sessionsQuery } = useSessionScope(student);

  const [from, setFrom] = useState(() => initialFrom ?? dateKeyDaysAgo(29));
  const [to, setTo] = useState(() => initialTo ?? dateKeyDaysAgo(0));

  const filtered = useMemo(
    () => scopedSessions.filter((s) => s.date >= from && s.date <= to),
    [scopedSessions, from, to],
  );

  const insights = useMemo(() => computeSessionInsights(filtered), [filtered]);
  const hourlyHeat = useMemo(() => computeHourlyHeatmap(filtered), [filtered]);
  const weeklyTrend = useMemo(() => dailyAggregates(filtered, from, to), [filtered, from, to]);
  const envCount = useMemo(() => countSessionsWithEnv(filtered), [filtered]);
  const externalLoads = useExternalLoads();
  const scheduleEvents = useScheduleEvents();
  // Attended classes (lectures/tutorials/labs) from the real timetable feed the
  // Focus Battery automatically — no need to re-type them. Over a fixed ~30-day
  // window (the recovery model looks back 14 days and ignores dates outside it).
  const scheduleLoads = useMemo(
    () =>
      isReviewerView
        ? []
        : externalLoadFromSchedule(
            scheduleEvents.data ?? [],
            dateKeyDaysAgo(29),
            dateKeyDaysAgo(0),
          ),
    [scheduleEvents.data, isReviewerView],
  );
  // External commitments are the viewer's own config, so only apply them when
  // looking at your own data (not a student you're reviewing).
  const wellbeing = useMemo(
    () =>
      computeWellbeing(
        filtered,
        isReviewerView ? [] : [...(externalLoads.data ?? []), ...scheduleLoads],
      ),
    [filtered, isReviewerView, externalLoads.data, scheduleLoads],
  );

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

  const hasTrends = filtered.length >= 3;

  const rawHours = filtered.reduce((sum, s) => sum + Math.max(0, s.durationMin), 0) / 60;
  const strainHours = sumStrainMinutes(filtered) / 60;
  const strainNote =
    filtered.length > 0
      ? `${rawHours.toFixed(1)}h studied ≈ ${strainHours.toFixed(1)} strain-hours once activity and company are weighted. Timetabled lectures count automatically.`
      : undefined;

  return (
    <>
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="grid w-full gap-1.5 sm:w-auto">
            <Label htmlFor="ins-from">From</Label>
            <Input
              id="ins-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full sm:w-[160px]"
            />
          </div>
          <div className="grid w-full gap-1.5 sm:w-auto">
            <Label htmlFor="ins-to">To</Label>
            <Input
              id="ins-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full sm:w-[160px]"
            />
          </div>
          <p className="text-sm text-muted-foreground sm:ml-auto">
            {filtered.length} session{filtered.length === 1 ? "" : "s"} · {envCount} with env data
          </p>
        </CardContent>
      </Card>

      <FocusBatteryCard report={wellbeing} note={strainNote} />

      <LoadReviewCard />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <StudyConditionsCard sessions={filtered} />
        <StudyTimeEffectCard sessions={filtered} />
      </div>

      {!hasTrends ? (
        <Card>
          <CardContent className="space-y-2 p-8 text-center text-sm text-muted-foreground">
            <p>
              Log at least <strong className="text-foreground">3 sessions</strong> to unlock your
              focus trends and best-hours heatmap.
            </p>
            <p>
              You have {filtered.length} session{filtered.length === 1 ? "" : "s"} in this range.
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
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Weekly focus trend</CardTitle>
            </CardHeader>
            <CardContent>
              <WeeklyTrendChart data={weeklyTrend} />
            </CardContent>
          </Card>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">When you study</CardTitle>
              </CardHeader>
              <CardContent>
                {insights.bestTimeSlot && (
                  <p className="mb-3 text-sm text-muted-foreground">
                    Most focus time in{" "}
                    <span className="font-medium text-foreground">
                      {insights.bestTimeSlot.label}
                    </span>{" "}
                    ({insights.bestTimeSlot.totalMinutes} min across{" "}
                    {insights.bestTimeSlot.sessions} session
                    {insights.bestTimeSlot.sessions === 1 ? "" : "s"}).
                  </p>
                )}
                <TimeOfDayHeatmapChart slots={insights.timeOfDay} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Hours you study most</CardTitle>
              </CardHeader>
              <CardContent>
                <HourlyHeatmapGrid cells={hourlyHeat} />
              </CardContent>
            </Card>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">By mode & completion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2.5">
                {insights.modeBreakdown.map((row) => {
                  const maxMin = Math.max(1, ...insights.modeBreakdown.map((r) => r.totalMinutes));
                  return (
                    <div key={row.mode} className="flex items-center gap-3 text-sm">
                      <span className="w-24 shrink-0">{row.mode}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-work"
                          style={{ width: `${(row.totalMinutes / maxMin) * 100}%` }}
                        />
                      </div>
                      <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
                        {row.totalMinutes} min · {row.count}×
                      </span>
                    </div>
                  );
                })}
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
        </>
      )}

      <p className="text-xs text-muted-foreground">
        "Focus Load" and the Focus Battery are transparent heuristics (0–100), not validated
        scientific or clinical measurements.
      </p>
    </>
  );
}
