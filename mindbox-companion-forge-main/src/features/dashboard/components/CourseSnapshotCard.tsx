import { Link } from "@tanstack/react-router";
import { ChevronRight, GraduationCap } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { countdownLabel } from "@/features/schedule/schedule";
import type { CourseSnapshot } from "@/features/dashboard/today";

/** Compact cross-course progress + the single course that most needs attention. */
export function CourseSnapshotCard({ snapshot }: { snapshot: CourseSnapshot }) {
  const { overall, urgent } = snapshot;

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Your courses</CardTitle>
        <Link
          to="/courses"
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
        >
          All courses
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Homework</p>
            <p className="mt-0.5 text-lg font-semibold tracking-tight">{overall.completionPct}%</p>
            <Progress value={overall.completionPct} className="mt-1.5 h-1.5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg grade</p>
            <p className="mt-0.5 text-lg font-semibold tracking-tight">
              {overall.creditWeightedGradeAverage ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Courses</p>
            <p className="mt-0.5 text-lg font-semibold tracking-tight">{overall.courseCount}</p>
          </div>
        </div>

        {urgent && (
          <Link
            to="/courses/$id"
            params={{ id: urgent.summary.course.id }}
            className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: urgent.summary.course.color }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                <span className="text-muted-foreground">{urgent.summary.course.code}</span>{" "}
                {urgent.summary.course.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {urgent.reason === "exam" && urgent.summary.nextExam
                  ? `Exam ${countdownLabel(urgent.summary.nextExam.dateKey)}`
                  : `${urgent.summary.completionPct}% of homework done`}
              </p>
            </div>
            <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
