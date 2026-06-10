-- ===========================================================================
-- MindBox — schedule: exams as a category + semester term
-- Makes the calendar practical: weekly classes are bounded to a semester, and
-- exams are first-class (distinct styling + countdown).
-- Run after 0001–0007, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

-- 1. Event category. Existing rows default to 'class'.
alter table public.schedule_events
  add column if not exists category text not null default 'class';

-- Re-runnable check constraint.
alter table public.schedule_events
  drop constraint if exists schedule_events_category_check;
alter table public.schedule_events
  add constraint schedule_events_category_check check (category in ('class', 'exam'));

-- 2. Semester term lives on the user's settings row. Weekly classes only repeat
--    within [semester_start, semester_end] when these are set.
alter table public.user_settings
  add column if not exists semester_label text;
alter table public.user_settings
  add column if not exists semester_start date;
alter table public.user_settings
  add column if not exists semester_end date;
