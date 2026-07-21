import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Progress } from "@/components/ui/progress";
import { useScheduleEvents, useScheduleActions } from "@/features/schedule/queries";
import {
  DAY_LABELS_FULL,
  countdownLabel,
  formatTimeDisplay,
  friendlyDateLabel,
  meetingTypeLabel,
} from "@/features/schedule/schedule";
import { useSettings } from "@/lib/queries/settings";
import { useHomeworkAssignments, useHomeworkActions } from "@/lib/queries/homework";
import type { HomeworkInput, HomeworkUpdateInput } from "@/lib/queries/homework";
import { useCourses, useCourseActions } from "@/features/courses/queries";
import type { CourseInput, WatchedCounts } from "@/features/courses/queries";
import {
  buildCourseSummary,
  courseStanding,
  examsForCourse,
  homeworkForCourse,
  matchesCode,
  plannedMeetingCounts,
} from "@/features/courses/courses";
import { CourseDialog } from "@/features/courses/components/CourseDialog";
import { CourseGradesTab } from "@/features/courses/components/CourseGradesTab";
import { WatchedMeetingsCard } from "@/features/courses/components/WatchedMeetingsCard";
import { HomeworkDialog } from "@/features/homework/components/HomeworkDialog";
import { HomeworkBoard } from "@/features/homework/components/HomeworkBoard";
import type { HomeworkAssignment, HomeworkStatus } from "@/lib/types";

export const Route = createFileRoute("/courses/$id")({
  head: () => ({ meta: [{ title: "Course — MindBox" }] }),
  component: CourseDetailPage,
});

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function CourseDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const coursesQuery = useCourses();
  const scheduleQuery = useScheduleEvents();
  const homeworkQuery = useHomeworkAssignments();
  const settingsQuery = useSettings();
  const courseActions = useCourseActions();
  const scheduleActions = useScheduleActions();
  const { add, update, remove, setStatus } = useHomeworkActions();

  const [editCourseOpen, setEditCourseOpen] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [hwOpen, setHwOpen] = useState(false);
  const [editingHw, setEditingHw] = useState<HomeworkAssignment | null>(null);
  const [hwError, setHwError] = useState<string | null>(null);

  const courses = coursesQuery.data ?? [];
  const events = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data]);
  const homework = useMemo(() => homeworkQuery.data ?? [], [homeworkQuery.data]);
  const course = courses.find((c) => c.id === id) ?? null;

  const summary = useMemo(
    () => (course ? buildCourseSummary(course, events, homework) : null),
    [course, events, homework],
  );

  const meetings = useMemo(
    () =>
      course
        ? events
            .filter((e) => e.category === "class" && matchesCode(e.courseCode, course.code))
            .sort(
              (a, b) =>
                (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) || a.startTime.localeCompare(b.startTime),
            )
        : [],
    [course, events],
  );
  const exams = useMemo(
    () => (course ? examsForCourse(events, course.code) : []),
    [course, events],
  );
  const courseHomework = useMemo(
    () => (course ? homeworkForCourse(homework, course.code) : []),
    [course, homework],
  );
  const homeworkById = useMemo(
    () => new Map(courseHomework.map((h) => [h.id, h])),
    [courseHomework],
  );

  const weeklyBounds = useMemo(
    () => ({
      start: settingsQuery.data?.semesterStart ?? null,
      end: settingsQuery.data?.semesterEnd ?? null,
    }),
    [settingsQuery.data],
  );
  const planned = useMemo(
    () => (course ? plannedMeetingCounts(events, course.code, weeklyBounds) : null),
    [course, events, weeklyBounds],
  );

  if (coursesQuery.isLoading || scheduleQuery.isLoading || homeworkQuery.isLoading) {
    return <LoadingState label="Loading course…" />;
  }

  if (coursesQuery.isError) {
    return (
      <ErrorState
        title="Could not load course"
        description={coursesQuery.error instanceof Error ? coursesQuery.error.message : undefined}
        onRetry={() => void coursesQuery.refetch()}
      />
    );
  }

  if (!course || !summary) {
    return (
      <EmptyState
        title="Course not found"
        description="This course may have been deleted."
        action={
          <Button asChild variant="outline">
            <Link to="/courses">
              <ArrowLeft className="h-4 w-4" />
              Back to courses
            </Link>
          </Button>
        }
      />
    );
  }

  const onCourseSubmit = (input: CourseInput) => {
    setCourseError(null);
    courseActions.update.mutate(
      { id: course.id, input },
      {
        onSuccess: () => setEditCourseOpen(false),
        onError: (e) =>
          setCourseError(e instanceof Error ? e.message : "Could not save the course."),
      },
    );
  };

  const deleteCourse = () => {
    courseActions.remove.mutate(
      { id: course.id, code: course.code },
      { onSuccess: () => void navigate({ to: "/courses" }) },
    );
  };

  const onSaveExam = (eventId: string, examWeight: number | null, examScore: number | null) => {
    scheduleActions.setExamGrade.mutate({ id: eventId, examWeight, examScore });
  };
  const onSaveWatched = (watched: WatchedCounts) => {
    courseActions.setWatched.mutate({ id: course.id, watched });
  };

  const openCreateHw = () => {
    setEditingHw(null);
    setHwError(null);
    setHwOpen(true);
  };
  const openEditHw = (hw: HomeworkAssignment) => {
    setEditingHw(hw);
    setHwError(null);
    setHwOpen(true);
  };
  const onHwSubmit = (input: HomeworkInput | HomeworkUpdateInput, file?: File) => {
    setHwError(null);
    const handlers = {
      onSuccess: () => {
        setHwOpen(false);
        setEditingHw(null);
      },
      onError: (e: Error) => setHwError(e.message),
    };
    if (editingHw) {
      update.mutate({ id: editingHw.id, input: input as HomeworkUpdateInput, file }, handlers);
    } else {
      add.mutate({ input: input as HomeworkInput, file }, handlers);
    }
  };

  const done = summary.homeworkByStatus.submitted + summary.homeworkByStatus.graded;
  const standing = courseStanding(summary);
  const watchedTotal = course.watchedLectures + course.watchedTutorials + course.watchedLabs;
  const plannedTotal = planned?.total ?? 0;
  const watchedPct = plannedTotal > 0 ? Math.round((watchedTotal / plannedTotal) * 100) : null;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
        <Link to="/courses">
          <ArrowLeft className="h-4 w-4" />
          Courses
        </Link>
      </Button>

      <div className="mb-1 flex items-center gap-2">
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-full"
          style={{ backgroundColor: course.color }}
          aria-hidden
        />
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
          {course.code}
        </span>
      </div>
      <PageHeader
        title={course.name}
        description={[
          course.code,
          course.instructor,
          course.credits != null ? `${course.credits} credits` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditCourseOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="text-danger hover:bg-danger/10"
                  disabled={courseActions.remove.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this course?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes <span className="font-medium">{course.name}</span> and its classes
                    and exams from your calendar. Homework you logged is kept.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteCourse}>Delete course</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        }
      />

      {/* "Where am I" band — the key numbers stay visible across every tab. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Standing"
          value={`${standing.value}${standing.suffix ? ` ${standing.suffix}` : ""}`}
          hint={standing.caption}
        />
        <Stat
          label="Homework"
          value={`${summary.completionPct}%`}
          hint={`${done}/${summary.homeworkTotal} done`}
        />
        <Stat
          label="Watched"
          value={watchedPct != null ? `${watchedPct}%` : String(watchedTotal)}
          hint={plannedTotal > 0 ? `${watchedTotal}/${plannedTotal} meetings` : "meetings"}
        />
        <Stat
          label="Next exam"
          value={
            summary.nextExam
              ? summary.nextExam.daysUntil <= 0
                ? "Today"
                : `${summary.nextExam.daysUntil}d`
              : "—"
          }
          hint={summary.nextExam ? "until next exam" : "none scheduled"}
        />
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="exams">Exams</TabsTrigger>
          <TabsTrigger value="homework">Homework</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label="Meetings"
              value={String(summary.meetings.total)}
              hint={
                [
                  summary.meetings.lecture ? `${summary.meetings.lecture} lec` : null,
                  summary.meetings.tutorial ? `${summary.meetings.tutorial} tut` : null,
                  summary.meetings.lab ? `${summary.meetings.lab} lab` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "weekly"
              }
            />
            <Stat label="Exams" value={String(summary.examCount)} hint="scheduled" />
            <Stat
              label="Credits"
              value={course.credits != null ? String(course.credits) : "—"}
              hint={course.instructor ?? undefined}
            />
          </div>

          <Card>
            <CardContent className="space-y-2 p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Homework completion</span>
                <span className="font-medium">{summary.completionPct}%</span>
              </div>
              <Progress value={summary.completionPct} aria-label="Homework completion" />
              {summary.nextExam && (
                <p className="flex items-center gap-1.5 pt-2 text-sm text-muted-foreground">
                  <CalendarClock className="h-4 w-4" />
                  Next exam {friendlyDateLabel(summary.nextExam.dateKey)} ·{" "}
                  <span className="font-medium text-foreground">
                    {summary.nextExam.daysUntil <= 0
                      ? "today"
                      : `in ${summary.nextExam.daysUntil} day${summary.nextExam.daysUntil === 1 ? "" : "s"}`}
                  </span>
                </p>
              )}
            </CardContent>
          </Card>

          {course.notes && (
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">{course.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="grades">
          <CourseGradesTab
            breakdown={summary.gradeBreakdown}
            homeworkById={homeworkById}
            onEditHomework={openEditHw}
            onSaveExam={onSaveExam}
            savingExamId={
              scheduleActions.setExamGrade.isPending
                ? scheduleActions.setExamGrade.variables?.id
                : null
            }
          />
        </TabsContent>

        <TabsContent value="meetings" className="space-y-4">
          {planned && (
            <WatchedMeetingsCard
              watched={{
                lectures: course.watchedLectures,
                tutorials: course.watchedTutorials,
                labs: course.watchedLabs,
              }}
              planned={planned}
              plannedFromTerm={!!weeklyBounds.start && !!weeklyBounds.end}
              onSave={onSaveWatched}
              saving={courseActions.setWatched.isPending}
            />
          )}
          <Card>
            <CardContent className="p-0">
              {meetings.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  No meetings yet. Add weekly lectures, tutorials, or labs with code{" "}
                  <span className="font-medium text-foreground">{course.code}</span> on the{" "}
                  <Link to="/calendar" className="text-primary underline">
                    calendar
                  </Link>
                  .
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {meetings.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {meetingTypeLabel(m.subtype)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.dayOfWeek != null ? DAY_LABELS_FULL[m.dayOfWeek] : ""} ·{" "}
                          {formatTimeDisplay(m.startTime)}–{formatTimeDisplay(m.endTime)}
                          {m.location ? ` · ${m.location}` : ""}
                        </p>
                      </div>
                      <Button asChild variant="ghost" size="sm">
                        <Link to="/calendar">View</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exams">
          <Card>
            <CardContent className="p-0">
              {exams.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">No exams scheduled.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {exams.map((ex) => (
                    <li key={ex.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{ex.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {ex.eventDate ? friendlyDateLabel(ex.eventDate) : ""} ·{" "}
                          {formatTimeDisplay(ex.startTime)}
                        </p>
                      </div>
                      {ex.eventDate && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {countdownLabel(ex.eventDate)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="homework" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreateHw}>
              <Plus className="h-4 w-4" />
              Add assignment
            </Button>
          </div>
          {courseHomework.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-muted-foreground">No homework for this course yet.</p>
            </div>
          ) : (
            <HomeworkBoard
              assignments={courseHomework}
              onMove={(hwId, status: HomeworkStatus) => setStatus.mutate({ id: hwId, status })}
              onEdit={openEditHw}
              onDelete={(hwId) => remove.mutate(hwId)}
              hideCourse
            />
          )}
        </TabsContent>
      </Tabs>

      <CourseDialog
        open={editCourseOpen}
        onOpenChange={setEditCourseOpen}
        editing={course}
        onSubmit={onCourseSubmit}
        busy={courseActions.update.isPending}
        error={courseError}
      />

      <HomeworkDialog
        open={hwOpen}
        onOpenChange={setHwOpen}
        editing={editingHw}
        courses={courses}
        defaultCourseCode={course.code}
        onSubmit={onHwSubmit}
        busy={add.isPending || update.isPending}
        error={hwError}
      />
    </>
  );
}
