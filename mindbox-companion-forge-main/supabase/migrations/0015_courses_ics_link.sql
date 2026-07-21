-- ===========================================================================
-- 0015_courses_ics_link.sql — tag courses with the .ics import that created them
-- Deleting an import already cascades the schedule_events it created
-- (schedule_events.ics_import_id, 0014). This links courses the same way, so
-- deleting an import removes its courses too — not just their classes/exams.
-- Manually-created courses stay null-tagged and untouched.
-- Run in the Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

alter table public.courses
  add column if not exists ics_import_id uuid references public.ics_imports (id) on delete cascade;

create index if not exists idx_courses_import on public.courses (ics_import_id);

notify pgrst, 'reload schema';
