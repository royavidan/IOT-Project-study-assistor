import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Eye, EyeOff, FileUp, GraduationCap, Plus, Sparkles, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScheduleEventDialog } from "@/features/schedule/components/ScheduleEventDialog";
import { CourseBuilderDialog } from "@/features/schedule/components/CourseBuilderDialog";
import { CalendarAgendaView } from "@/features/schedule/components/CalendarAgendaView";
import { CalendarDayView } from "@/features/schedule/components/CalendarDayView";
import { CalendarMonthView } from "@/features/schedule/components/CalendarMonthView";
import { CalendarFab } from "@/features/schedule/components/CalendarFab";
import { SemesterSheet } from "@/features/schedule/components/SemesterSheet";
import { ImportCalendarSheet } from "@/features/schedule/components/ImportCalendarSheet";
import { GenerateScheduleSheet } from "@/features/planner/components/GenerateScheduleSheet";
import { PlanStaleBanner } from "@/features/planner/components/PlanStaleBanner";
import { useClearPlanMeta } from "@/features/planner/queries";
import { STUDY_PLANNER_ENABLED } from "@/lib/feature-flags";
import { useAutoSyncStaleImports } from "@/features/schedule/ics-queries";
import { parseDateKey, toDateKey, todayDateKey } from "@/lib/dates";
import { filterSessionsByUser } from "@/lib/session-scope";
import { useAuth } from "@/lib/auth/auth-context";
import { useSessions } from "@/lib/queries/sessions";
import { useScheduleActions, useScheduleEvents } from "@/features/schedule/queries";
import type { ScheduleEventInput } from "@/features/schedule/queries";
import { useCourseActions } from "@/features/courses/queries";
import { useSettings } from "@/lib/queries/settings";
import type { ScheduleEvent } from "@/features/schedule/schedule";

const VIEWS = ["agenda", "day", "month"] as const;
type CalendarView = (typeof VIEWS)[number];

export const Route = createFileRoute("/calendar")({
  validateSearch: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    view: z.enum(VIEWS).optional().catch(undefined),
    hideStudy: z.boolean().optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: "Calendar — MindBox" }] }),
  component: CalendarPage,
});

function CalendarPage() {
  const { user } = useAuth();
  const { date: dateParam, view: viewParam, hideStudy: hideStudyParam } = Route.useSearch();
  const navigate = Route.useNavigate();

  const [view, setView] = useState<CalendarView>(viewParam ?? "agenda");
  const [selectedDate, setSelectedDate] = useState(() => dateParam ?? todayDateKey());
  const [visibleMonth, setVisibleMonth] = useState(() => parseDateKey(dateParam ?? todayDateKey()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [courseOpen, setCourseOpen] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const clearPlanMeta = useClearPlanMeta();
  const [hideStudy, setHideStudy] = useState(hideStudyParam ?? false);
  const [clearOpen, setClearOpen] = useState(false);

  // Re-sync any URL-imported calendar that's gone stale (~once a day).
  useAutoSyncStaleImports();

  const scheduleQuery = useScheduleEvents();
  const sessionsQuery = useSessions();
  const settingsQuery = useSettings();
  const { add, addMany, update, remove, replaceGenerated } = useScheduleActions();
  const courseActions = useCourseActions();

  const weeklyBounds = {
    start: settingsQuery.data?.semesterStart ?? null,
    end: settingsQuery.data?.semesterEnd ?? null,
  };

  const ownSessions = useMemo(
    () => filterSessionsByUser(sessionsQuery.data ?? [], user?.id, user?.id),
    [sessionsQuery.data, user?.id],
  );

  const changeView = (next: CalendarView) => {
    setView(next);
    void navigate({ search: (prev) => ({ ...prev, view: next }), replace: true });
  };

  const toggleHideStudy = () => {
    const next = !hideStudy;
    setHideStudy(next);
    void navigate({
      search: (prev) => ({ ...prev, hideStudy: next || undefined }),
      replace: true,
    });
  };

  // Clear planner-generated study blocks across a wide window (recent past →
  // future) so a partially-elapsed plan is fully removed. Hand-made study blocks
  // (plan_generated=false) are preserved by the scoped delete.
  const clearGeneratedPlan = () => {
    const today = todayDateKey();
    const from = parseDateKey(today);
    from.setDate(from.getDate() - 30);
    const to = parseDateKey(today);
    to.setDate(to.getDate() + 90);
    replaceGenerated.mutate(
      { fromKey: toDateKey(from), toKey: toDateKey(to), inputs: [] },
      // Also drop the plan-meta stamp so the stale banner doesn't nag about a
      // plan that no longer exists.
      { onSuccess: () => clearPlanMeta.mutate() },
    );
  };

  const selectDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setVisibleMonth(parseDateKey(dateKey));
    void navigate({ search: (prev) => ({ ...prev, date: dateKey }), replace: true });
  };

  const selectDateAndOpenDay = (dateKey: string) => {
    selectDate(dateKey);
    changeView("day");
  };

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (eventId: string) => {
    const event = (scheduleQuery.data ?? []).find((e) => e.id === eventId) ?? null;
    setEditing(event);
    setFormError(null);
    setDialogOpen(true);
  };

  const onSubmit = (input: ScheduleEventInput) => {
    setFormError(null);
    const handlers = {
      onSuccess: () => {
        setDialogOpen(false);
        setEditing(null);
      },
      onError: (e: Error) => setFormError(e.message),
    };
    if (editing) {
      update.mutate({ id: editing.id, input }, handlers);
    } else {
      add.mutate(input, handlers);
    }
  };

  const onCourseSubmit = (events: ScheduleEventInput[]) => {
    setCourseError(null);
    addMany.mutate(events, {
      onSuccess: () => {
        setCourseOpen(false);
        // Mirror the course into the courses table so it appears under /courses.
        const code = events.find((e) => e.courseCode)?.courseCode?.trim();
        const named = events.find((e) => e.category === "class") ?? events[0];
        if (code && named) {
          courseActions.upsert.mutate({
            code,
            name: named.title,
            color: named.color,
            notes: named.notes ?? null,
          });
        }
      },
      onError: (e) => setCourseError(e instanceof Error ? e.message : "Could not add the course."),
    });
  };

  if (scheduleQuery.isLoading || sessionsQuery.isLoading) {
    return <LoadingState label="Loading your calendar…" />;
  }

  if (scheduleQuery.isError || sessionsQuery.isError) {
    return (
      <ErrorState
        title="Could not load calendar"
        description={
          (scheduleQuery.error ?? sessionsQuery.error) instanceof Error
            ? (scheduleQuery.error ?? sessionsQuery.error)?.message
            : undefined
        }
        onRetry={() => {
          void scheduleQuery.refetch();
          void sessionsQuery.refetch();
        }}
      />
    );
  }

  const events = scheduleQuery.data ?? [];
  const hasGenerated = events.some((e) => e.category === "study" && e.planGenerated);
  const shownEvents = hideStudy ? events.filter((e) => e.category !== "study") : events;
  const busy = remove.isPending || update.isPending;

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Classes, exams, and MindBox focus sessions in one place."
        actions={
          <div className="flex items-center gap-2">
            <SemesterSheet />
            {/* Mobile: keep Auto-plan reachable without opening the FAB. */}
            {STUDY_PLANNER_ENABLED && (
              <Button
                variant="outline"
                size="icon"
                className="lg:hidden"
                onClick={() => setPlanOpen(true)}
                aria-label="Auto-plan study time"
              >
                <Sparkles className="h-4 w-4" />
              </Button>
            )}
            <div className="hidden gap-2 lg:flex">
              <Button variant="ghost" asChild>
                <Link to="/courses">
                  <GraduationCap className="h-4 w-4" />
                  Courses
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileUp className="h-4 w-4" />
                Import
              </Button>
              {STUDY_PLANNER_ENABLED && (
                <Button variant="outline" onClick={() => setPlanOpen(true)}>
                  <Sparkles className="h-4 w-4" />
                  Auto-plan
                </Button>
              )}
              {STUDY_PLANNER_ENABLED && hasGenerated && (
                <Button variant="outline" onClick={() => setClearOpen(true)}>
                  <Trash2 className="h-4 w-4" />
                  Clear plan
                </Button>
              )}
              <Button variant="outline" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Add event
              </Button>
              <Button
                onClick={() => {
                  setCourseError(null);
                  setCourseOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Add course
              </Button>
            </div>
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && changeView(v as CalendarView)}
          variant="outline"
          className="grid w-full max-w-sm grid-cols-3 sm:w-auto"
        >
          <ToggleGroupItem value="agenda" className="min-h-10">
            Agenda
          </ToggleGroupItem>
          <ToggleGroupItem value="day" className="min-h-10">
            Day
          </ToggleGroupItem>
          <ToggleGroupItem value="month" className="min-h-10">
            Month
          </ToggleGroupItem>
        </ToggleGroup>

        {hasGenerated && (
          <Button
            variant={hideStudy ? "default" : "outline"}
            size="sm"
            className="min-h-10"
            onClick={toggleHideStudy}
            aria-pressed={hideStudy}
          >
            {hideStudy ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {hideStudy ? "Study hidden" : "Study blocks"}
          </Button>
        )}
      </div>

      {STUDY_PLANNER_ENABLED && <PlanStaleBanner onRegenerate={() => setPlanOpen(true)} />}

      {view === "agenda" && (
        <CalendarAgendaView
          events={shownEvents}
          sessions={ownSessions}
          weeklyBounds={weeklyBounds}
          onEditCourse={openEdit}
          onDeleteCourse={(id) => remove.mutate(id)}
          busy={busy}
        />
      )}

      {view === "day" && (
        <CalendarDayView
          events={shownEvents}
          sessions={ownSessions}
          weeklyBounds={weeklyBounds}
          selectedDate={selectedDate}
          onSelectDate={selectDate}
          onEditCourse={openEdit}
          onDeleteCourse={(id) => remove.mutate(id)}
          busy={busy}
        />
      )}

      {view === "month" && (
        <CalendarMonthView
          events={shownEvents}
          weeklyBounds={weeklyBounds}
          selectedDate={selectedDate}
          visibleMonth={visibleMonth}
          onVisibleMonthChange={setVisibleMonth}
          onSelectDate={selectDateAndOpenDay}
        />
      )}

      <CalendarFab
        onAddEvent={openCreate}
        onAddCourse={() => {
          setCourseError(null);
          setCourseOpen(true);
        }}
        onImport={() => setImportOpen(true)}
        onPlanWeek={STUDY_PLANNER_ENABLED ? () => setPlanOpen(true) : undefined}
        onClearPlan={STUDY_PLANNER_ENABLED && hasGenerated ? () => setClearOpen(true) : undefined}
      />

      <ScheduleEventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDate={selectedDate}
        editing={editing}
        onSubmit={onSubmit}
        busy={add.isPending || update.isPending}
        error={formError}
      />

      <CourseBuilderDialog
        open={courseOpen}
        onOpenChange={setCourseOpen}
        initialDate={selectedDate}
        onSubmit={onCourseSubmit}
        busy={addMany.isPending}
        error={courseError}
      />

      <ImportCalendarSheet open={importOpen} onOpenChange={setImportOpen} />

      {STUDY_PLANNER_ENABLED && (
        <GenerateScheduleSheet open={planOpen} onOpenChange={setPlanOpen} />
      )}

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the auto-planned study blocks?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the study blocks the planner generated. Study blocks you added yourself
              are kept, along with your classes, exams, and homework.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={clearGeneratedPlan} disabled={replaceGenerated.isPending}>
              {replaceGenerated.isPending ? "Clearing…" : "Clear plan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
