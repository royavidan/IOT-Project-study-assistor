-- 0023: Scheduled load review — contact throttle + the last assessment
-- (powers the /insights banner and the 72h "don't nag" guard).
-- Run by hand in the Supabase SQL editor.

alter table public.user_settings
  add column if not exists last_load_review_at timestamptz,
  add column if not exists last_load_review jsonb;

notify pgrst, 'reload schema';
