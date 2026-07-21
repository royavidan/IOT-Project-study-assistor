-- 0021: Post-session check-in — the user's own report after a session ends
-- (tiredness 1-5 + optional note; homework % lands on the existing
-- homework_assignments.progress_pct). checkin_at doubles as the "already
-- answered" marker for the dashboard card. Columns-on-sessions, following the
-- 0019 (companions) precedent. Run by hand in the Supabase SQL editor.

alter table public.sessions
  add column if not exists tiredness smallint
    check (tiredness is null or tiredness between 1 and 5),
  add column if not exists checkin_at timestamptz,
  add column if not exists checkin_note text;

notify pgrst, 'reload schema';
