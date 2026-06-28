# Feature: schedule

Calendar / focus-block scheduling (`/calendar`, mobile-first Agenda/Day/Month switcher).
- `schedule.ts` — schedule domain logic. `queries.ts` — schedule queries.
- `ics.ts` — pure iCalendar parser (CheeseFork/Technion-tuned: RRULE weekly classes, `מועד` all-day exams,
  HE+EN `"{type} {group} - {course}"` summaries; no course code → name-keyed). `ics.functions.ts` —
  `importIcsFn`/`syncIcsImportFn` server fns (fetch URL server-side, parse, upsert courses + insert events
  tagged `ics_import_id`). `ics-queries.ts` — `useIcsImports`/`useIcsActions` + `useAutoSyncStaleImports`
  (re-sync URL imports >24h old, once per session). Migrations `0014_ics_imports.sql` +
  `0015_courses_ics_link.sql` (`courses.ics_import_id`, `on delete cascade` — deleting an import drops
  the courses it created **and** their events; `persistParsed` tags upserted courses with the import id).
- `schedule.ts` `courseMarkersByDate(occurrences)` → per-day `CourseMarker[]` for the **Month** grid,
  colored by course (distinct color+category, exams first, capped at `MAX_DAY_MARKERS`).
- `components/{ScheduleEventDialog,CourseBuilderDialog}` (now responsive bottom-sheets via `ResponsiveModal`),
  `ScheduleTimeline` (classes/exams = full cards; **focus sessions = slim single-line rows**), the views
  `Calendar{Agenda,Day,Month}View` + `AgendaRow`, `CalendarFab`, `SemesterSheet`, `ImportCalendarSheet`
  (Link/Upload + manage/delete imports). `CalendarMonthView` dots are course-colored (filled = class,
  hollow ring = exam); no focus markers in the month grid.

Shared used: `@/lib/queries/sessions`, `@/lib/session-scope`, `@/lib/supabase`, `@/features/courses`.
