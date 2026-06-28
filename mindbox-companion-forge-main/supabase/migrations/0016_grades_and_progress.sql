-- ===========================================================================
-- 0016_grades_and_progress.sql — weighted grade scheme + watched counters
-- Adds the "points out of 100" grade model: each assignment/exam can carry a
-- weight (points toward the final grade); exams also record their score. Courses
-- gain manual per-meeting-type "watched" counters (schedule vs actual).
-- Run in the Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

-- Homework: points this assignment is worth toward the final grade (null = not counted).
alter table public.homework_assignments
  add column if not exists weight numeric(5, 2);
alter table public.homework_assignments
  drop constraint if exists homework_weight_valid;
alter table public.homework_assignments
  add constraint homework_weight_valid check (weight is null or weight >= 0);

-- Exams (schedule_events with category = 'exam'): weight toward the final grade
-- and the recorded score (0–100). Null on non-exam rows.
alter table public.schedule_events
  add column if not exists exam_weight numeric(5, 2);
alter table public.schedule_events
  add column if not exists exam_score numeric(5, 2);
alter table public.schedule_events
  drop constraint if exists schedule_exam_weight_valid;
alter table public.schedule_events
  add constraint schedule_exam_weight_valid check (exam_weight is null or exam_weight >= 0);
alter table public.schedule_events
  drop constraint if exists schedule_exam_score_valid;
alter table public.schedule_events
  add constraint schedule_exam_score_valid
    check (exam_score is null or (exam_score >= 0 and exam_score <= 100));

-- Courses: manual "watched" counters per meeting type (schedule vs actual).
alter table public.courses
  add column if not exists watched_lectures smallint not null default 0;
alter table public.courses
  add column if not exists watched_tutorials smallint not null default 0;
alter table public.courses
  add column if not exists watched_labs smallint not null default 0;
alter table public.courses
  drop constraint if exists courses_watched_valid;
alter table public.courses
  add constraint courses_watched_valid check (
    watched_lectures >= 0 and watched_tutorials >= 0 and watched_labs >= 0
  );

notify pgrst, 'reload schema';
