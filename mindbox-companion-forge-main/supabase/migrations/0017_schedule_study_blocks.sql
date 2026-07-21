-- ===========================================================================
-- 0017_schedule_study_blocks.sql — add a third event category: "study"
-- A study block is a self-planned study session (not a class, not an exam, not
-- graded). It can repeat weekly or be one-time, like a class. Calendar-only —
-- it doesn't roll into course meeting/exam counts.
-- Run in the Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

alter table public.schedule_events
  drop constraint if exists schedule_events_category_check;
alter table public.schedule_events
  add constraint schedule_events_category_check
    check (category in ('class', 'exam', 'study'));

notify pgrst, 'reload schema';
