-- ===========================================================================
-- 0012_homework_assignments.sql — homework assignments for students
-- Stores homework exercises with file uploads, due dates, and submission status
-- File size limit: 25 MB per file (enforced at application level)
-- Run in the Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

create table if not exists public.homework_assignments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  course_code       text,
  title             text not null,
  description       text,
  due_date          date not null,
  status            text not null default 'pending' check (status in ('pending', 'submitted', 'graded')),
  file_url          text,
  file_name         text,
  file_size_bytes   integer,
  grade             decimal(5,2),
  notes             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  constraint homework_file_size_valid check (file_size_bytes is null or file_size_bytes > 0)
);

create index if not exists idx_homework_assignments_user on public.homework_assignments (user_id);
create index if not exists idx_homework_assignments_due_date on public.homework_assignments (due_date);
create index if not exists idx_homework_assignments_status on public.homework_assignments (status);
create index if not exists idx_homework_assignments_course on public.homework_assignments (course_code);

alter table public.homework_assignments enable row level security;

grant select, insert, update, delete on public.homework_assignments to authenticated;

drop policy if exists homework_assignments_owner_all on public.homework_assignments;
create policy homework_assignments_owner_all on public.homework_assignments
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
