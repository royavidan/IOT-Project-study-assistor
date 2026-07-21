-- ===========================================================================
-- 0013_courses.sql — real course metadata, joined to schedule + homework by code
-- A "course" gets a row here (code, name, color, instructor, credits, target
-- grade). Schedule events and homework still link by the free-text course_code,
-- so existing rows keep working — one course per (user, code).
-- Also adds an optional per-assignment progress override to homework.
-- Run in the Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

create table if not exists public.courses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  code          text not null,
  name          text not null,
  color         text not null default '#6366f1',
  instructor    text,
  credits       numeric(4,1) check (credits is null or credits >= 0),
  target_grade  numeric(5,2) check (target_grade is null or (target_grade >= 0 and target_grade <= 100)),
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint courses_code_not_blank check (length(btrim(code)) > 0),
  constraint courses_user_code_unique unique (user_id, code)
);

create index if not exists idx_courses_user on public.courses (user_id);
create index if not exists idx_courses_code on public.courses (code);

alter table public.courses enable row level security;

grant select, insert, update, delete on public.courses to authenticated;

drop policy if exists courses_owner_all on public.courses;
create policy courses_owner_all on public.courses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Per-assignment progress override (0..100). Null = derive completion from status.
alter table public.homework_assignments
  add column if not exists progress_pct smallint;
alter table public.homework_assignments
  drop constraint if exists homework_progress_pct_valid;
alter table public.homework_assignments
  add constraint homework_progress_pct_valid
    check (progress_pct is null or (progress_pct >= 0 and progress_pct <= 100));

notify pgrst, 'reload schema';
