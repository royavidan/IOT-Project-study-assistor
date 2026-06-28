import { Link } from "@tanstack/react-router";
import { CalendarClock, GraduationCap, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { CourseSummary } from "@/features/courses/courses";
import { cn } from "@/lib/utils";

function meetingsSummary(m: CourseSummary["meetings"]): string {
  const parts: string[] = [];
  if (m.lecture) parts.push(`${m.lecture} lecture${m.lecture === 1 ? "" : "s"}`);
  if (m.tutorial) parts.push(`${m.tutorial} tutorial${m.tutorial === 1 ? "" : "s"}`);
  if (m.lab) parts.push(`${m.lab} lab${m.lab === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "No meetings yet";
}

export function CourseCard({
  summary,
  onDelete,
  deleting,
}: {
  summary: CourseSummary;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { course, meetings, nextExam, homeworkTotal, homeworkByStatus, completionPct } = summary;
  const done = homeworkByStatus.submitted + homeworkByStatus.graded;

  return (
    <Card className="relative overflow-hidden transition-colors hover:border-primary/40">
      {onDelete && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1.5 top-1.5 z-10 h-8 w-8 text-muted-foreground hover:text-danger"
              disabled={deleting}
              aria-label={`Delete ${course.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this course?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes <span className="font-medium">{course.name}</span> and its classes and
                exams from your calendar. Homework you logged is kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete course</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <Link to="/courses/$id" params={{ id: course.id }} className="block">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3 pr-8">
            <span
              className="mt-1 h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: course.color }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  {course.code}
                </span>
                {course.credits != null && (
                  <span className="text-xs text-muted-foreground">{course.credits} cr</span>
                )}
              </div>
              <h3 className="mt-1 truncate font-semibold text-foreground">{course.name}</h3>
              {course.instructor && (
                <p className="truncate text-xs text-muted-foreground">{course.instructor}</p>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{meetingsSummary(meetings)}</p>

          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Homework</span>
              <span className="font-medium text-foreground">
                {done}/{homeworkTotal} done · {completionPct}%
              </span>
            </div>
            <Progress
              value={completionPct}
              className="mt-1.5 h-2"
              aria-label="Homework completion"
            />
          </div>

          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="h-4 w-4" />
              {nextExam ? (
                <span>
                  Next exam{" "}
                  <span className="font-medium text-foreground">
                    {nextExam.daysUntil <= 0
                      ? "today"
                      : `in ${nextExam.daysUntil} day${nextExam.daysUntil === 1 ? "" : "s"}`}
                  </span>
                </span>
              ) : (
                <span>No upcoming exam</span>
              )}
            </div>
            <GradePill summary={summary} />
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}

function GradePill({ summary }: { summary: CourseSummary }) {
  const { gradeAverage, targetGrade, gradeVsTarget, gradeBreakdown } = summary;

  // Prefer the weighted "points out of 100" standing when a grade scheme exists.
  if (gradeBreakdown.components.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <GraduationCap className="h-3 w-3" />
        {gradeBreakdown.earnedPoints}
        <span className="opacity-70">/ 100</span>
      </span>
    );
  }

  if (gradeAverage == null) {
    return <span className="text-xs text-muted-foreground">No grades yet</span>;
  }
  const onTrack = gradeVsTarget == null || gradeVsTarget >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        targetGrade == null
          ? "bg-muted text-muted-foreground"
          : onTrack
            ? "bg-success/10 text-success"
            : "bg-warning-muted text-warning-foreground",
      )}
    >
      <GraduationCap className="h-3 w-3" />
      {gradeAverage}
      {targetGrade != null && <span className="opacity-70">/ {targetGrade}</span>}
    </span>
  );
}
