import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { DeleteSessionDialog } from "@/components/DeleteSessionDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StudentScopePicker } from "@/components/StudentScopePicker";
import { InfoHint } from "@/components/InfoHint";
import { useSessionScope } from "@/hooks/use-session-scope";
import { dateKeyDaysAgo } from "@/lib/dates";
import { useDailyAggregates } from "@/lib/queries/sessions";
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
  head: () => ({ meta: [{ title: "Session History — MindBox" }] }),
  component: History,
});

function statusClass(status: string) {
  switch (status) {
    case "completed":
      return "bg-success/10 text-success";
    case "interrupted":
      return "bg-warning-muted text-warning-foreground";
    default:
      return "bg-danger-muted text-danger";
  }
}

function History() {
  const navigate = useNavigate({ from: "/history" });
  const { student: studentParam, from: fromParam, to: toParam } = Route.useSearch();
  const [from, setFrom] = useState(() => fromParam ?? dateKeyDaysAgo(29));
  const [to, setTo] = useState(() => toParam ?? dateKeyDaysAgo(0));

  const { students, viewingStudent, isReviewerView, targetId } = useSessionScope(studentParam);
  const { daily, streak, scopedSessions, isLoading, isError, error, refetch } = useDailyAggregates(
    from,
    to,
    targetId,
  );

  const filtered = useMemo(
    () => scopedSessions.filter((s) => s.date >= from && s.date <= to),
    [scopedSessions, from, to],
  );
  const totalMin = filtered.reduce((sum, s) => sum + s.durationMin, 0);
  const hours = (totalMin / 60).toFixed(1);

  const chartData = daily.map((d) => ({
    day: d.date.slice(5),
    minutes: d.minutes,
    score: d.avgScore,
  }));

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

  if (isLoading) {
    return <LoadingState label="Loading session history…" />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Could not load session history"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={isReviewerView ? "Student sessions" : "Session history"}
        description={
          isReviewerView
            ? `Read-only view for ${viewingStudent?.displayName ?? "student"}.`
            : "Every focus session, logged from your device."
        }
        actions={
          <Link
            to="/insights"
            search={{ from, to, ...(studentParam ? { student: studentParam } : {}) }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Insights →
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
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
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
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                syncDatesToUrl(from, e.target.value);
              }}
              className="w-full sm:w-[160px]"
            />
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Total focused</p>
            <p className="text-2xl font-semibold tabular-nums">
              {hours}
              <span className="text-sm font-normal text-muted-foreground"> h</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="mb-4 text-xs text-muted-foreground">
        Streak:{" "}
        <span className="font-medium text-foreground">
          {streak} day{streak === 1 ? "" : "s"}
        </span>
        . If no session is logged within 24 hours, the streak resets to zero.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Focus minutes by day</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-muted-foreground)"
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                <RTooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="minutes" fill="var(--color-work)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex-row items-center gap-2">
          <CardTitle className="text-base">Focus Load Estimate (heuristic)</CardTitle>
          <InfoHint label="About Focus Load Estimate">
            This is a heuristic estimate based on session length and observed attention patterns. It
            is not a validated scientific measurement and should not be used as a clinical or
            cognitive assessment.
          </InfoHint>
        </CardHeader>
        <CardContent>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-muted-foreground)"
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-muted-foreground)"
                />
                <RTooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
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
            Score range 0–100. Heuristic only — not a validated scientific measurement.{" "}
            <Link
              to="/insights"
              search={{ from, to, ...(studentParam ? { student: studentParam } : {}) }}
              className="text-sync hover:underline"
            >
              See cross-session patterns in Insights
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sessions ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {filtered.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No sessions in this range.
            </p>
          )}
          {filtered.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1 px-5 py-3 transition-colors hover:bg-accent/50"
            >
              <Link
                to="/session/$id"
                params={{ id: s.id }}
                className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {s.subject} · <span className="font-normal text-muted-foreground">{s.mode}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.date} · {s.start} · {s.durationMin} min · {s.breaks} break
                    {s.breaks === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusClass(s.status)}`}
                  >
                    {s.status}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {s.focusScore}
                  </span>
                </div>
              </Link>
              {!isReviewerView && (
                <DeleteSessionDialog sessionId={s.id} variant="icon" redirectTo={null} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
