-- ===========================================================================
-- MindBox — external load (general commitments like lectures/labs)
-- Feeds the Recovery balance wellbeing estimate (src/lib/wellbeing.ts).
-- Safe to re-run. Run after 0001–0005, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

create table if not exists public.external_loads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles (id) on delete cascade,
  label      text not null,
  kind       text not null default 'weekly', -- 'weekly' (hours/week) | 'dated' (hours on a date)
  hours      real not null default 0,
  date       date,                            -- set when kind = 'dated'
  created_at timestamptz default now()
);

create index if not exists idx_external_loads_user on public.external_loads (user_id);

alter table public.external_loads enable row level security;

grant select, insert, update, delete on public.external_loads to authenticated;

-- Owner-only access (same shape as user_settings / sessions).
drop policy if exists external_loads_owner_all on public.external_loads;
create policy external_loads_owner_all on public.external_loads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
