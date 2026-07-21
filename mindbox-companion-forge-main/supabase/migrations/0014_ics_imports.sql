-- ===========================================================================
-- 0014_ics_imports.sql — imported calendars (.ics) that build a schedule
-- Each import groups the schedule_events it created so the whole schedule can be
-- deleted or re-synced as a unit. URL imports can be re-fetched; file imports
-- are one-off. Links to schedule_events via ics_import_id (cascade delete).
-- Run in the Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

create table if not exists public.ics_imports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  name           text not null,
  source_type    text not null check (source_type in ('url', 'file')),
  source_url     text,
  event_count    integer not null default 0,
  last_synced_at timestamptz default now(),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists idx_ics_imports_user on public.ics_imports (user_id);

alter table public.ics_imports enable row level security;

grant select, insert, update, delete on public.ics_imports to authenticated;

drop policy if exists ics_imports_owner_all on public.ics_imports;
create policy ics_imports_owner_all on public.ics_imports
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Tag schedule_events with the import that created them. Deleting an import
-- removes exactly its events; manually-added events stay null and untouched.
alter table public.schedule_events
  add column if not exists ics_import_id uuid references public.ics_imports (id) on delete cascade;

create index if not exists idx_schedule_events_import on public.schedule_events (ics_import_id);

notify pgrst, 'reload schema';
