import { Link } from "@tanstack/react-router";
import { CalendarClock, Eye, Trash2 } from "lucide-react";

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
import { courseStanding, type CourseSummary } from "@/features/courses/courses";
import { cn } from "@/lib/utils";

function meetingsSummary(m: CourseSummary["meetings"]): string {
  const parts: string[] = [];
  if (m.lecture) parts.push(`${m.lecture} lecture${m.lecture === 1 ? "" : "s"}`);
  if (m.tutorial) parts.push(`${m.tutorial} tutorial${m.tutorial === 1 ? "" : "s"}`);
  if (m.lab) parts.push(`${m.lab} lab${m.lab === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "No meetings yet";
}

const STANDING_TONE: Record<string, string> = {
  neutral: "text-foreground",
  good: "text-success",
  warn: "text-warning-foreground",
};

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
  const watched = course.watchedLectures + course.watchedTutorials + course.watchedLabs;
  const standing = courseStanding(summary);

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

          {/* Progress-led: standing + homework completion side by side. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Standing</p>
              <p
                className={cn(
                  "mt-0.5 text-2xl font-semibold tracking-tight",
                  STANDING_TONE[standing.tone],
                )}
              >
                {standing.value}
                {standing.suffix && (
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {standing.suffix}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{standing.caption}</p>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Homework</span>
                <span className="font-medium text-foreground">
                  {done}/{homeworkTotal}
                </span>
              </div>
              <Progress
                value={completionPct}
                className="mt-1.5 h-2"
                aria-label="Homework completion"
              />
              <p className="mt-1 text-xs text-muted-foreground">{completionPct}% done</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              {meetingsSummary(meetings)}
              {watched > 0 && <span> · {watched} watched</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {nextExam ? (
                <>
                  <CalendarClock className="h-3.5 w-3.5" />
                  {nextExam.daysUntil <= 0 ? "Exam today" : `Exam in ${nextExam.daysUntil}d`}
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  No exam
                </>
              )}
            </span>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}
