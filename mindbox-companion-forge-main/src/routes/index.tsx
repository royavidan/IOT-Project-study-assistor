import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { StateBadge } from "@/components/StateBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { todayStats, mockSessions } from "@/lib/mock-data";
import { Battery, Wifi, Play, Clock, Flame, Sparkles, Pause } from "lucide-react";

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
  const pct = Math.min(100, Math.round((todayStats.focusMinutes / todayStats.goalMinutes) * 100));
  const active = todayStats.activeSession;

  return (
    <>
      <PageHeader
        title="Today"
        description="Calm focus. One session at a time."
        actions={<StateBadge state={todayStats.deviceState} />}
      />

      {/* Focus today */}
      <Card className="mb-6 overflow-hidden border-work/20">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Focus today</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight">
                {todayStats.focusMinutes}
                <span className="text-base font-normal text-muted-foreground">
                  {" "}/ {todayStats.goalMinutes} min
                </span>
              </p>
            </div>
            <Button>
              <Play className="h-4 w-4" /> Start session
            </Button>
          </div>
          <div className="mt-4">
            <Progress value={pct} aria-label={`Daily progress ${pct}%`} />
            <p className="mt-2 text-xs text-muted-foreground">{pct}% of daily goal</p>
          </div>
        </CardContent>
      </Card>

      {/* Quick stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Clock} label="Sessions" value={String(todayStats.sessions)} />
        <Stat icon={Flame} label="Streak" value={`${todayStats.streak}d`} />
        <Stat icon={Battery} label="Battery" value={`${todayStats.battery}%`} />
        <Stat icon={Wifi} label="Wi-Fi" value={todayStats.wifi} />
      </div>

      {/* Active session OR motivation nudge */}
      {active ? (
        <Card className="mb-6 border-work/30 bg-work-muted/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full bg-work pulse-sync" aria-hidden />
              <div>
                <p className="text-sm font-semibold">Active session · {active.subject}</p>
                <p className="text-xs text-muted-foreground">
                  Started {active.start} · {active.mode}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm">
              <Pause className="h-4 w-4" /> Pause
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-6 border-info/20 bg-info/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-info/15 text-info">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold">A gentle nudge</p>
                <p className="text-sm text-muted-foreground">
                  No active session. A short 25-minute block now keeps your{" "}
                  <span className="font-medium text-foreground">{todayStats.streak}-day streak</span> alive.
                </p>
              </div>
            </div>
            <Button size="sm">Start 25 min</Button>
          </CardContent>
        </Card>
      )}

      {/* Recent */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Recent sessions</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/history">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {mockSessions.slice(0, 4).map((s) => (
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
        </CardContent>
      </Card>
    </>
  );
}
