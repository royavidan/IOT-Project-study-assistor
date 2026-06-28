import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StateBadge } from "@/components/StateBadge";
import { EmptyState, ErrorState, LoadingState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { LowBatteryBanner } from "@/components/LowBatteryBanner";
import { useAuth } from "@/lib/auth/auth-context";
import { dateKeyDaysAgo } from "@/lib/dates";
import { computeDashboardInsightTeaser } from "@/features/insights/insights";
import { filterSessionsByUser } from "@/lib/session-scope";
import { BATTERY_TRACKING_ENABLED } from "@/lib/feature-flags";
import { useReviewerStudents } from "@/features/social/reviewer";
import { maybeSendWeeklySummaries } from "@/features/reports/report-email.functions";
import { useSessions, useTodayStats } from "@/lib/queries/sessions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  Battery,
  Wifi,
  Clock,
  Flame,
  Calendar,
  CalendarDays,
  FlaskConical,
  ShieldCheck,
  LineChart,
} from "lucide-react";

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
  const { data: todayStats, isLoading, isError, error, refetch } = useTodayStats();
  const sessionsQuery = useSessions();
  const reviewerStudents = useReviewerStudents();
  const weeklyShareRan = useRef(false);
  const [weeklyNote, setWeeklyNote] = useState<string | null>(null);

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

  if (isLoading) {
    return <LoadingState label="Loading dashboard…" />;
  }

  if (isError || !todayStats) {
    return (
      <ErrorState
        title="Could not load dashboard"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  const pct = Math.min(100, Math.round((todayStats.focusMinutes / todayStats.goalMinutes) * 100));
  // Sessions are started/controlled on the box (device-first invariant), so
  // "active" is derived from live device state rather than an app action.
  const deviceActive = todayStats.deviceState === "work" || todayStats.deviceState === "break";
  const recent = filterSessionsByUser(sessionsQuery.data ?? [], user?.id, user?.id).slice(0, 4);
  const reviewingCount = reviewerStudents.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Today"
        description="Calm focus. One session at a time."
        actions={<StateBadge state={todayStats.deviceState} battery={todayStats.battery} />}
      />

      {weeklyNote && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
        >
          {weeklyNote}
        </p>
      )}

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
        className={`mb-6 grid grid-cols-2 gap-3 ${
          BATTERY_TRACKING_ENABLED ? "sm:grid-cols-4" : "sm:grid-cols-3"
        }`}
      >
        <Stat icon={Clock} label="Sessions" value={String(todayStats.sessions)} />
        <Stat icon={Flame} label="Streak" value={`${todayStats.streak}d`} />
        {BATTERY_TRACKING_ENABLED && (
          <Stat icon={Battery} label="Battery" value={`${todayStats.battery}%`} />
        )}
        <Stat icon={Wifi} label="Wi-Fi" value={todayStats.wifi} />
      </div>

      <Card className="mb-6 border-primary/15 bg-primary/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <CalendarDays className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold">Plan your week</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Add lectures and labs to your calendar and see them alongside MindBox focus
                sessions.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/calendar">Open calendar</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-6 border-sync/20 bg-sync-muted/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sync/15 text-sync">
              <LineChart className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold">{insightTeaser.headline}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{insightTeaser.detail}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/progress"
              search={{ tab: "insights", from: insightTeaser.from, to: insightTeaser.to }}
            >
              Open Insights
            </Link>
          </Button>
        </CardContent>
      </Card>

      {deviceActive ? (
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
      ) : (
        recent.length === 0 && (
          <Card className="mb-6 border-dashed">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="text-sm text-muted-foreground">
                No sessions yet. Start on your MindBox or log one manually while you wait for
                hardware.
              </p>
              <Button size="sm" variant="outline" asChild>
                <Link to="/simulator">
                  <FlaskConical className="h-4 w-4" /> Log a session
                </Link>
              </Button>
            </CardContent>
          </Card>
        )
      )}

      <Card>
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
              description="Sessions from your MindBox device will appear here once synced."
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
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    {s.focusScore}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
