import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StateBadge } from "@/components/StateBadge";
import { EmptyState, ErrorState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { LowBatteryBanner } from "@/components/LowBatteryBanner";
import { useAuth } from "@/lib/auth/auth-context";
import { dateKeyDaysAgo, toDateKey } from "@/lib/dates";
import { computeDashboardInsightTeaser } from "@/features/insights/insights";
import { filterSessionsByUser } from "@/lib/session-scope";
import { BATTERY_TRACKING_ENABLED, STUDY_PLANNER_ENABLED } from "@/lib/feature-flags";
import { useReviewerStudents } from "@/features/social/reviewer";
import { maybeSendWeeklySummaries } from "@/features/reports/report-email.functions";
import { useSessions, useTodayStats } from "@/lib/queries/sessions";
import { useScheduleEvents } from "@/features/schedule/queries";
import { useHomeworkAssignments } from "@/lib/queries/homework";
import { useCourses } from "@/features/courses/queries";
import { useSettings } from "@/lib/queries/settings";
import { useMyDevice } from "@/features/device/queries";
import { buildCourseSummaries } from "@/features/courses/courses";
import {
  courseSnapshot,
  dueSoon,
  greetingFor,
  isEngaged,
  nextExam,
  onboardingSteps,
  pickNextAction,
  todaysOccurrences,
} from "@/features/dashboard/today";
import { TodayPlanCard } from "@/features/dashboard/components/TodayPlanCard";
import { NextActionBar } from "@/features/dashboard/components/NextActionBar";
import { CourseSnapshotCard } from "@/features/dashboard/components/CourseSnapshotCard";
import { QuickActions } from "@/features/dashboard/components/QuickActions";
import { GettingStartedCard } from "@/features/dashboard/components/GettingStartedCard";
import { DashboardSkeleton } from "@/features/dashboard/components/DashboardSkeleton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  Battery,
  Clock,
  Flame,
  Calendar,
  FlaskConical,
  ShieldCheck,
  LineChart,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { GenerateScheduleSheet } from "@/features/planner/components/GenerateScheduleSheet";
import { PlanStaleBanner } from "@/features/planner/components/PlanStaleBanner";
import { SessionCheckinCard } from "@/features/sessions/components/SessionCheckinCard";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — MindBox Companion" }] }),
  component: Dashboard,
});

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const todayStatsQuery = useTodayStats();
  const sessionsQuery = useSessions();
  const scheduleQuery = useScheduleEvents();
  const homeworkQuery = useHomeworkAssignments();
  const coursesQuery = useCourses();
  const settingsQuery = useSettings();
  const myDeviceQuery = useMyDevice();
  const reviewerStudents = useReviewerStudents();
  const weeklyShareRan = useRef(false);
  const [weeklyNote, setWeeklyNote] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  const todayStats = todayStatsQuery.data;

  // Keep the user's UTC offset on their profile so the box's "today" total
  // (computed server-side in GET /ingest/config) matches this dashboard's local day.
  const tzSyncRan = useRef(false);
  useEffect(() => {
    if (tzSyncRan.current || !user?.id) return;
    tzSyncRan.current = true;
    const offsetMin = -new Date().getTimezoneOffset(); // minutes ahead of UTC
    void getSupabaseBrowserClient()
      .from("profiles")
      .update({ tz_offset_min: offsetMin })
      .eq("id", user.id);
  }, [user?.id]);

  useEffect(() => {
    if (weeklyShareRan.current) return;
    weeklyShareRan.current = true;
    void maybeSendWeeklySummaries()
      .then((result) => {
        if (result.sent > 0 && "recipients" in result && result.recipients?.length) {
          setWeeklyNote(
            `Weekly PDF report emailed to ${result.recipients.join(", ")} (${result.sent} recipient${result.sent === 1 ? "" : "s"}).`,
          );
        }
      })
      .catch(() => {
        // Non-blocking — share may be disabled or email not configured.
      });
  }, []);

  // Computed before any early return so the hook order stays identical across
  // the loading -> loaded transition (Rules of Hooks).
  const insightTeaser = useMemo(() => {
    const own = filterSessionsByUser(sessionsQuery.data ?? [], user?.id, user?.id);
    const from = dateKeyDaysAgo(29);
    const to = dateKeyDaysAgo(0);
    const lastMonth = own.filter((s) => s.date >= from && s.date <= to);
    return { ...computeDashboardInsightTeaser(lastMonth), from, to };
  }, [sessionsQuery.data, user?.id]);

  const weeklyBounds = useMemo(
    () => ({
      start: settingsQuery.data?.semesterStart ?? null,
      end: settingsQuery.data?.semesterEnd ?? null,
    }),
    [settingsQuery.data],
  );

  // The academic "today": classes now, homework due soon, the next exam, the
  // single dominant next action, and a cross-course progress snapshot.
  const today = useMemo(() => {
    const events = scheduleQuery.data ?? [];
    const homework = homeworkQuery.data ?? [];
    const courses = coursesQuery.data ?? [];
    const now = new Date();
    const occurrences = todaysOccurrences(events, toDateKey(now), weeklyBounds);
    const due = dueSoon(homework, 7, now);
    const exam = nextExam(events, now);
    const action = pickNextAction(due, exam);
    const { perCourse, overall } = buildCourseSummaries(courses, events, homework, now);
    return { occurrences, due, exam, action, snapshot: courseSnapshot(overall, perCourse) };
  }, [scheduleQuery.data, homeworkQuery.data, coursesQuery.data, weeklyBounds]);

  // Skeleton until the queries that decide the dashboard's *shape* have resolved,
  // so the layout doesn't flip from empty-state to engaged mid-render.
  const coreLoading =
    todayStatsQuery.isLoading ||
    sessionsQuery.isLoading ||
    myDeviceQuery.isLoading ||
    settingsQuery.isLoading;

  if (coreLoading) {
    return <DashboardSkeleton />;
  }

  if (todayStatsQuery.isError || !todayStats) {
    return (
      <ErrorState
        title="Could not load dashboard"
        description={
          todayStatsQuery.error instanceof Error ? todayStatsQuery.error.message : undefined
        }
        onRetry={() => void todayStatsQuery.refetch()}
      />
    );
  }

  const ownSessions = filterSessionsByUser(sessionsQuery.data ?? [], user?.id, user?.id);
  const recent = ownSessions.slice(0, 4);
  const reviewingCount = reviewerStudents.data?.length ?? 0;

  // Engagement state — decides whether to show device/session stats or the
  // getting-started flow. No more walls of zeros for a fresh account.
  const hasDevice = !!myDeviceQuery.data;
  const hasSessions = ownSessions.length > 0;
  const hasCourses = (coursesQuery.data ?? []).length > 0;
  const hasSchedule = (scheduleQuery.data ?? []).length > 0;
  const hasHomework = (homeworkQuery.data ?? []).length > 0;
  const engaged = isEngaged({ hasDevice, hasSessions });
  const steps = onboardingSteps({ hasCourses, hasSchedule, hasDevice, hasSessions });

  const displayName = settingsQuery.data?.displayName?.trim() || user?.email?.split("@")[0] || "";
  const greeting = greetingFor(displayName);
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const pct = Math.min(100, Math.round((todayStats.focusMinutes / todayStats.goalMinutes) * 100));
  // Sessions are started/controlled on the box (device-first invariant), so
  // "active" is derived from live device state rather than an app action.
  const deviceActive = todayStats.deviceState === "work" || todayStats.deviceState === "break";
  // Show the "Next up" bar for real homework/exam actions always; only show the
  // generic "start a session" fallback to engaged users who aren't mid-session
  // (new users get that prompt from the checklist instead).
  const showNextAction = today.action.kind !== "session" || (engaged && !deviceActive);
  const hasAcademics = hasSchedule || hasHomework;

  return (
    <>
      <PageHeader
        title={greeting}
        description={dateLabel}
        actions={
          hasDevice ? (
            <StateBadge state={todayStats.deviceState} battery={todayStats.battery} />
          ) : undefined
        }
      />

      {weeklyNote && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
        >
          {weeklyNote}
        </p>
      )}

      {STUDY_PLANNER_ENABLED && <PlanStaleBanner onRegenerate={() => setPlanOpen(true)} />}

      <SessionCheckinCard />

      {reviewingCount > 0 && recent.length === 0 && (
        <Card className="mb-6 border-info/20 bg-info/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
              <div>
                <p className="text-sm font-semibold">Reviewer access active</p>
                <p className="text-sm text-muted-foreground">
                  You can follow {reviewingCount} student{reviewingCount === 1 ? "" : "s"} from
                  Sessions — use the student picker to switch views.
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" asChild>
              <Link to="/progress" search={{ tab: "sessions" }}>
                View students
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {BATTERY_TRACKING_ENABLED && todayStats.battery > 0 && todayStats.battery < 15 && (
        <LowBatteryBanner battery={todayStats.battery} />
      )}

      <QuickActions hasDevice={hasDevice} />

      {showNextAction && <NextActionBar action={today.action} />}

      {hasAcademics && (
        <TodayPlanCard occurrences={today.occurrences} due={today.due} nextExam={today.exam} />
      )}

      {STUDY_PLANNER_ENABLED && hasAcademics && (
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold">Plan your week</p>
                <p className="text-sm text-muted-foreground">
                  Auto-fill your free time with study blocks that ramp up before deadlines — you
                  review before anything's added.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => setPlanOpen(true)}>
              <Sparkles className="h-4 w-4" />
              Auto-plan
            </Button>
          </CardContent>
        </Card>
      )}

      {hasCourses && <CourseSnapshotCard snapshot={today.snapshot} />}

      {engaged ? (
        <>
          <Card className="mb-6 overflow-hidden border-work/20">
            <CardContent className="p-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Focus today</p>
                  <p className="mt-1 text-4xl font-semibold tracking-tight">
                    {todayStats.focusMinutes}
                    <span className="text-base font-normal text-muted-foreground">
                      {" "}
                      / {todayStats.goalMinutes} min
                    </span>
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Start &amp; stop sessions on your MindBox.
                </p>
              </div>
              <div className="mt-4">
                <Progress value={pct} aria-label={`Daily progress ${pct}%`} />
                <p className="mt-2 text-xs text-muted-foreground">{pct}% of daily goal</p>
              </div>
            </CardContent>
          </Card>

          <div
            className={`mb-6 grid gap-3 ${
              BATTERY_TRACKING_ENABLED ? "grid-cols-3" : "grid-cols-2"
            }`}
          >
            <Stat icon={Clock} label="Sessions" value={String(todayStats.sessions)} />
            <Stat icon={Flame} label="Streak" value={`${todayStats.streak}d`} />
            {BATTERY_TRACKING_ENABLED && (
              <Stat icon={Battery} label="Battery" value={`${todayStats.battery}%`} />
            )}
          </div>

          {deviceActive && (
            <Card className="mb-6 border-work/30 bg-work-muted/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-work pulse-sync" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold">
                      {todayStats.deviceState === "work" ? "Focus in progress" : "On a break"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Running on your MindBox — controls are on the device.
                    </p>
                  </div>
                </div>
                <StateBadge state={todayStats.deviceState} battery={todayStats.battery} />
              </CardContent>
            </Card>
          )}

          <Card className="mb-6">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Recent sessions</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/progress" search={{ tab: "sessions" }}>
                  View all
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {recent.length === 0 ? (
                <EmptyState
                  icon={<Calendar className="h-8 w-8" />}
                  title="No sessions yet"
                  description="Sessions from your MindBox will appear here once synced. Or log one in the simulator."
                  action={
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/simulator">
                        <FlaskConical className="h-4 w-4" /> Log a session
                      </Link>
                    </Button>
                  }
                  className="border-0 bg-transparent"
                />
              ) : (
                <div className="divide-y divide-border">
                  {recent.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="text-sm font-medium">{s.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.date} · {s.start} · {s.durationMin} min
                        </p>
                      </div>
                      <span
                        className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                        title="Focus Load Estimate (strain, not a grade)"
                      >
                        Load {s.focusScore}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Link
            to="/progress"
            search={{ tab: "insights", from: insightTeaser.from, to: insightTeaser.to }}
            className="group mb-6 flex items-center gap-3 rounded-lg border border-sync/20 bg-sync-muted/20 p-4 transition-colors hover:border-sync/40"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sync/15 text-sync">
              <LineChart className="h-4 w-4" aria-hidden />
            </div>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{insightTeaser.headline}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {insightTeaser.detail}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </>
      ) : (
        <GettingStartedCard steps={steps} />
      )}

      {STUDY_PLANNER_ENABLED && (
        <GenerateScheduleSheet open={planOpen} onOpenChange={setPlanOpen} />
      )}
    </>
  );
}
