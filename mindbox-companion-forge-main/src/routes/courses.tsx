import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { GraduationCap, Plus } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useScheduleEvents } from "@/features/schedule/queries";
import { useHomeworkAssignments } from "@/lib/queries/homework";
import { useCourses, useCourseActions } from "@/features/courses/queries";
import type { CourseInput } from "@/features/courses/queries";
import { buildCourseSummaries } from "@/features/courses/courses";
import { CourseCard } from "@/features/courses/components/CourseCard";
import { CourseDialog } from "@/features/courses/components/CourseDialog";

export const Route = createFileRoute("/courses")({
  head: () => ({ meta: [{ title: "Courses — MindBox" }] }),
  component: CoursesPage,
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function CoursesPage() {
  const coursesQuery = useCourses();
  const scheduleQuery = useScheduleEvents();
  const homeworkQuery = useHomeworkAssignments();
  const { add, remove } = useCourseActions();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { perCourse, overall } = useMemo(
    () =>
      buildCourseSummaries(
        coursesQuery.data ?? [],
        scheduleQuery.data ?? [],
        homeworkQuery.data ?? [],
      ),
    [coursesQuery.data, scheduleQuery.data, homeworkQuery.data],
  );

  const openCreate = () => {
    setFormError(null);
    setDialogOpen(true);
  };

  const onSubmit = (input: CourseInput) => {
    setFormError(null);
    add.mutate(input, {
      onSuccess: () => setDialogOpen(false),
      onError: (e) => setFormError(e instanceof Error ? e.message : "Could not save the course."),
    });
  };

  if (coursesQuery.isLoading || scheduleQuery.isLoading || homeworkQuery.isLoading) {
    return <LoadingState label="Loading your courses…" />;
  }

  if (coursesQuery.isError) {
    return (
      <ErrorState
        title="Could not load courses"
        description={
          coursesQuery.error instanceof Error
            ? `${coursesQuery.error.message} — make sure migration 0013 has been run in Supabase.`
            : undefined
        }
        onRetry={() => void coursesQuery.refetch()}
      />
    );
  }

  const hasCourses = perCourse.length > 0;

  return (
    <>
      <PageHeader
        title="Courses"
        description="Each course in one place — its lectures, tutorials, exams, and homework."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add course
          </Button>
        }
      />

      {hasCourses && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Courses" value={String(overall.courseCount)} />
          <Stat label="Credits" value={String(overall.totalCredits)} />
          <Stat label="Homework done" value={`${overall.completionPct}%`} />
          <Stat
            label="Avg grade"
            value={
              overall.creditWeightedGradeAverage == null
                ? "—"
                : String(overall.creditWeightedGradeAverage)
            }
          />
        </div>
      )}

      {hasCourses ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {perCourse.map((summary) => (
            <CourseCard
              key={summary.course.id}
              summary={summary}
              onDelete={() => remove.mutate({ id: summary.course.id, code: summary.course.code })}
              deleting={remove.isPending && remove.variables?.id === summary.course.id}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<GraduationCap className="h-8 w-8" />}
          title="No courses yet"
          description="Add a course to pull its lectures, tutorials, exams, and homework together. Use the same code on your calendar events and assignments so they link up."
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add course
            </Button>
          }
        />
      )}

      <CourseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={onSubmit}
        busy={add.isPending}
        error={formError}
      />
    </>
  );
}
