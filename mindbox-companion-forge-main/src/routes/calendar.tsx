import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { ChevronLeft, ChevronRight, GraduationCap, Plus } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { ScheduleEventDialog } from "@/features/schedule/components/ScheduleEventDialog";
import { CourseBuilderDialog } from "@/features/schedule/components/CourseBuilderDialog";
import { ScheduleTimeline } from "@/features/schedule/components/ScheduleTimeline";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { parseDateKey, todayDateKey, toDateKey } from "@/lib/dates";
import { filterSessionsByUser } from "@/lib/session-scope";
import { useAuth } from "@/lib/auth/auth-context";
import { useSessions } from "@/lib/queries/sessions";
import { useScheduleActions, useScheduleEvents } from "@/features/schedule/queries";
import type { ScheduleEventInput } from "@/features/schedule/queries";
import { useSaveSettings, useSettings } from "@/lib/queries/settings";
import type { ScheduleEvent } from "@/features/schedule/schedule";
import {
  buildDayAgenda,
  countdownLabel,
  datesWithFocus,
  expandScheduleEvents,
  formatTimeDisplay,
  friendlyDateLabel,
  monthDateRange,
  upcomingExams,
  weekDateKeys,
} from "@/features/schedule/schedule";

export const Route = createFileRoute("/calendar")({
  validateSearch: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  head: () => ({ meta: [{ title: "Calendar — MindBox" }] }),
  component: CalendarPage,
});

function CalendarPage() {
  const { user } = useAuth();
  const { date: dateParam } = Route.useSearch();
  const navigate = Route.useNavigate();

  const [selectedDate, setSelectedDate] = useState(() => dateParam ?? todayDateKey());
  const [visibleMonth, setVisibleMonth] = useState(() => parseDateKey(dateParam ?? todayDateKey()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [courseOpen, setCourseOpen] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);

  const scheduleQuery = useScheduleEvents();
  const sessionsQuery = useSessions();
  const { add, addMany, update, remove } = useScheduleActions();

  const settingsQuery = useSettings();
  const saveSettings = useSaveSettings();
  const semStart = settingsQuery.data?.semesterStart ?? null;
  const semEnd = settingsQuery.data?.semesterEnd ?? null;
  const semesterActive = Boolean(semStart || semEnd);

  const [semLabel, setSemLabel] = useState("");
  const [semStartInput, setSemStartInput] = useState("");
  const [semEndInput, setSemEndInput] = useState("");
  const [semSaved, setSemSaved] = useState(false);
  const [semError, setSemError] = useState<string | null>(null);
  const hydratedSemester = useRef(false);

  // Seed the draft inputs once from saved settings — later re-fetches (e.g. on
  // window focus) must not clobber what the user is typing.
  useEffect(() => {
    if (!settingsQuery.data || hydratedSemester.current) return;
    hydratedSemester.current = true;
    setSemLabel(settingsQuery.data.semesterLabel ?? "");
    setSemStartInput(settingsQuery.data.semesterStart ?? "");
    setSemEndInput(settingsQuery.data.semesterEnd ?? "");
  }, [settingsQuery.data]);

  const persistSemester = (label: string | null, start: string | null, end: string | null) => {
    if (!settingsQuery.data) return;
    setSemSaved(false);
    setSemError(null);
    if (start && end && end < start) {
      setSemError("Semester end must be on or after the start date.");
      return;
    }
    saveSettings.mutate(
      { ...settingsQuery.data, semesterLabel: label, semesterStart: start, semesterEnd: end },
      {
        onSuccess: () => {
          setSemSaved(true);
          window.setTimeout(() => setSemSaved(false), 2500);
        },
        onError: (e) =>
          setSemError(
            e instanceof Error
              ? `${e.message} — make sure migration 0008 has been run in Supabase.`
              : "Could not save the semester.",
          ),
      },
    );
  };

  const saveSemester = () =>
    persistSemester(semLabel.trim() || null, semStartInput || null, semEndInput || null);

  const clearSemester = () => {
    setSemLabel("");
    setSemStartInput("");
    setSemEndInput("");
    persistSemester(null, null, null);
  };

  const ownSessions = useMemo(
    () => filterSessionsByUser(sessionsQuery.data ?? [], user?.id, user?.id),
    [sessionsQuery.data, user?.id],
  );

  const monthRange = useMemo(() => monthDateRange(visibleMonth), [visibleMonth]);
  const weekKeys = useMemo(() => weekDateKeys(selectedDate), [selectedDate]);

  const monthOccurrences = useMemo(
    () =>
      expandScheduleEvents(scheduleQuery.data ?? [], monthRange.from, monthRange.to, {
        start: semStart,
        end: semEnd,
      }),
    [scheduleQuery.data, monthRange.from, monthRange.to, semStart, semEnd],
  );

  const weekOccurrences = useMemo(
    () =>
      expandScheduleEvents(scheduleQuery.data ?? [], weekKeys[0], weekKeys[6], {
        start: semStart,
        end: semEnd,
      }),
    [scheduleQuery.data, weekKeys, semStart, semEnd],
  );

  const classDates = useMemo(
    () => new Set(monthOccurrences.filter((o) => o.category !== "exam").map((o) => o.date)),
    [monthOccurrences],
  );
  const examDates = useMemo(
    () => new Set(monthOccurrences.filter((o) => o.category === "exam").map((o) => o.date)),
    [monthOccurrences],
  );
  const focusDates = useMemo(() => datesWithFocus(ownSessions), [ownSessions]);
  const upcoming = useMemo(() => upcomingExams(scheduleQuery.data ?? []), [scheduleQuery.data]);

  const dayAgenda = useMemo(
    () => buildDayAgenda(weekOccurrences, ownSessions, selectedDate),
    [weekOccurrences, ownSessions, selectedDate],
  );

  const daySummary = useMemo(() => {
    const courses = dayAgenda.filter((i) => i.type === "course").length;
    const focusMin = dayAgenda
      .filter((i) => i.type === "focus")
      .reduce((sum, i) => sum + (i.endMinutes - i.startMinutes), 0);
    return { courses, focusMin };
  }, [dayAgenda]);

  const selectDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setVisibleMonth(parseDateKey(dateKey));
    void navigate({ search: { date: dateKey }, replace: true });
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
      onSuccess: () => setCourseOpen(false),
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

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Plan classes and exams, set your semester, and track MindBox focus sessions in one place."
        actions={
          <div className="flex gap-2">
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
        }
      />

      <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Class
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-danger" /> Exam
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-success" /> MindBox focus
        </span>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">
                {visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </CardTitle>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
                  }
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
                  }
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex justify-center pb-4">
              <Calendar
                mode="single"
                month={visibleMonth}
                onMonthChange={setVisibleMonth}
                selected={parseDateKey(selectedDate)}
                onSelect={(date) => date && selectDate(toDateKey(date))}
                modifiers={{
                  hasCourse: (date) => classDates.has(toDateKey(date)),
                  hasExam: (date) => examDates.has(toDateKey(date)),
                  hasFocus: (date) => focusDates.has(toDateKey(date)),
                }}
                modifiersClassNames={{
                  hasCourse: "font-semibold",
                  hasExam: "font-semibold text-danger",
                }}
                components={{
                  DayButton: ({ day, modifiers, ...props }) => (
                    <div className="relative flex flex-col items-center">
                      <CalendarDayButton day={day} modifiers={modifiers} {...props} />
                      {(modifiers.hasCourse || modifiers.hasExam || modifiers.hasFocus) && (
                        <span className="pointer-events-none absolute bottom-0.5 flex gap-0.5">
                          {modifiers.hasExam && (
                            <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
                          )}
                          {modifiers.hasCourse && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                          )}
                          {modifiers.hasFocus && (
                            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                          )}
                        </span>
                      )}
                    </div>
                  ),
                }}
              />
            </CardContent>
            <CardContent className="border-t border-border pt-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => selectDate(todayDateKey())}
              >
                Jump to today
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Semester</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Set your term so weekly classes only repeat between these dates. Leave both blank
                for no limit.
              </p>
              {semesterActive && (
                <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                  Active:{" "}
                  <span className="font-medium text-foreground">
                    {settingsQuery.data?.semesterLabel || "Semester"}
                  </span>
                  {semStart ? ` · from ${semStart}` : ""}
                  {semEnd ? ` to ${semEnd}` : ""}
                </p>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="sem-label">Label</Label>
                <Input
                  id="sem-label"
                  placeholder="Fall 2026"
                  value={semLabel}
                  onChange={(e) => setSemLabel(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="sem-start">Start</Label>
                  <Input
                    id="sem-start"
                    type="date"
                    value={semStartInput}
                    onChange={(e) => setSemStartInput(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sem-end">End</Label>
                  <Input
                    id="sem-end"
                    type="date"
                    value={semEndInput}
                    onChange={(e) => setSemEndInput(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={saveSemester} disabled={saveSettings.isPending}>
                  {saveSettings.isPending ? "Saving…" : "Save semester"}
                </Button>
                {semesterActive && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearSemester}
                    disabled={saveSettings.isPending}
                  >
                    Clear
                  </Button>
                )}
                {semSaved && <span className="text-xs text-success">Saved.</span>}
              </div>
              {semError && <p className="text-xs text-danger">{semError}</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {upcoming.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GraduationCap className="h-4 w-4 text-danger" aria-hidden />
                  Upcoming exams
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {upcoming.slice(0, 5).map((u) => (
                    <li
                      key={u.event.id}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <button
                        type="button"
                        onClick={() => selectDate(u.dateKey)}
                        className="min-w-0 text-left"
                      >
                        <p className="truncate text-sm font-medium">{u.event.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {friendlyDateLabel(u.dateKey)} · {formatTimeDisplay(u.event.startTime)}
                          {u.event.courseCode ? ` · ${u.event.courseCode}` : ""}
                        </p>
                      </button>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                          u.daysUntil <= 3
                            ? "bg-danger-muted text-danger"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {countdownLabel(u.dateKey)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{friendlyDateLabel(selectedDate)}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {daySummary.courses} course{daySummary.courses === 1 ? "" : "s"} ·{" "}
                    {daySummary.focusMin} min focus
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/history" search={{ from: selectedDate, to: selectedDate }}>
                    Session history
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {semesterActive &&
                Boolean(
                  (semStart && selectedDate < semStart) || (semEnd && selectedDate > semEnd),
                ) && (
                  <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Outside your semester ({settingsQuery.data?.semesterLabel || "term"}) — weekly
                    classes are hidden on this day. One-off events and exams still show.
                  </p>
                )}
              <div className="mb-5 grid grid-cols-7 gap-1">
                {weekKeys.map((key) => {
                  const d = parseDateKey(key);
                  const count = buildDayAgenda(weekOccurrences, ownSessions, key).length;
                  const active = key === selectedDate;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectDate(key)}
                      className={cn(
                        "rounded-lg border px-1 py-2 text-center transition-colors",
                        active
                          ? "border-primary bg-primary/5"
                          : "border-transparent hover:bg-muted/60",
                      )}
                    >
                      <p className="text-[10px] uppercase text-muted-foreground">
                        {d.toLocaleDateString(undefined, { weekday: "short" })}
                      </p>
                      <p className="text-sm font-semibold">{d.getDate()}</p>
                      {count > 0 && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {count} item{count === 1 ? "" : "s"}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              <ScheduleTimeline
                items={dayAgenda}
                onEditCourse={openEdit}
                onDeleteCourse={(id) => remove.mutate(id)}
                busy={remove.isPending || update.isPending}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your courses</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {events.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground">
                  No courses saved yet. Add weekly lectures or one-off exams to build your
                  timetable.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {events.map((event) => (
                    <li
                      key={event.id}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: event.color }}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{event.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {event.kind === "weekly"
                              ? `Every ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][event.dayOfWeek ?? 0]}`
                              : event.eventDate}{" "}
                            · {event.startTime}–{event.endTime}
                            {event.courseCode ? ` · ${event.courseCode}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(event.id)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(event.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

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
    </>
  );
}
