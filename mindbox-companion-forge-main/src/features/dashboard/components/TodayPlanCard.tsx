import { Link } from "@tanstack/react-router";
import { BookOpen, CalendarClock, Clock } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  categoryLabel,
  countdownLabel,
  formatTimeDisplay,
  type ScheduleOccurrence,
  type UpcomingExam,
} from "@/features/schedule/schedule";
import type { DueItem } from "@/features/dashboard/today";
import { cn } from "@/lib/utils";

/**
 * The "what's on today" card: today's classes/study/exams + the homework that's
 * due soon, plus a next-exam chip. The academic anchor of the mobile dashboard.
 */
export function TodayPlanCard({
  occurrences,
  due,
  nextExam,
}: {
  occurrences: ScheduleOccurrence[];
  due: DueItem[];
  nextExam: UpcomingExam | null;
}) {
  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Today</CardTitle>
        {nextExam && (
          <Link
            to="/calendar"
            className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Next exam {countdownLabel(nextExam.dateKey)}
          </Link>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Classes
          </p>
          {occurrences.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes today — a clear run.</p>
          ) : (
            <ul className="space-y-2">
              {occurrences.map((o) => (
                <li key={o.occurrenceKey} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {formatTimeDisplay(o.startTime)}
                  </span>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: o.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {categoryLabel(o.category, o.subtype)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Due soon
            </p>
            <Link to="/assignments" className="text-xs text-muted-foreground hover:text-foreground">
              All assignments
            </Link>
          </div>
          {due.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due in the next week.</p>
          ) : (
            <ul className="space-y-2">
              {due.slice(0, 4).map((d) => (
                <li key={d.hw.id}>
                  <Link
                    to="/assignments"
                    className="flex items-center gap-3 rounded-md px-1 py-0.5 -mx-1 hover:bg-muted/50"
                  >
                    <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {d.hw.title}
                      {d.hw.courseCode && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {d.hw.courseCode}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                        d.overdue
                          ? "bg-danger/10 text-danger"
                          : d.daysUntil <= 0
                            ? "bg-warning-muted text-warning-foreground"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {d.overdue
                        ? `${Math.abs(d.daysUntil)}d overdue`
                        : d.daysUntil <= 0
                          ? "Today"
                          : countdownLabel(d.hw.dueDate.slice(0, 10))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
