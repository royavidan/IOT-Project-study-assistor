-- ===========================================================================
-- MindBox — course / schedule calendar (weekly classes + one-off events)
-- Run after 0001–0006, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

create table if not exists public.schedule_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  title        text not null,
  course_code  text,
  location     text,
  color        text not null default '#6366f1',
  kind         text not null default 'weekly' check (kind in ('weekly', 'once')),
  day_of_week  smallint check (day_of_week between 0 and 6),
  event_date   date,
  start_time   text not null,
  end_time     text not null,
  notes        text,
  created_at   timestamptz default now(),
  constraint schedule_weekly_has_dow check (kind <> 'weekly' or day_of_week is not null),
  constraint schedule_once_has_date check (kind <> 'once' or event_date is not null)
);

create index if not exists idx_schedule_events_user on public.schedule_events (user_id);
create index if not exists idx_schedule_events_date on public.schedule_events (event_date)
  where event_date is not null;

alter table public.schedule_events enable row level security;

grant select, insert, update, delete on public.schedule_events to authenticated;

drop policy if exists schedule_events_owner_all on public.schedule_events;
create policy schedule_events_owner_all on public.schedule_events
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
