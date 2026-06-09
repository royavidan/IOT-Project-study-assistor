-- ===========================================================================
-- MindBox study assistant — initial schema (Step 1.2)
-- Safe to re-run: tables use IF NOT EXISTS, policies are dropped first, and
-- functions use CREATE OR REPLACE.
--
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- App users. Mirrors auth.users (1:1) and is auto-populated by a trigger.
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  email         text,
  daily_goal_min int default 180,
  created_at    timestamptz default now()
);

-- Physical MindBox devices. id is the hardware-provided device id (text).
create table if not exists public.devices (
  id               text primary key,
  owner_user_id    uuid references public.profiles (id) on delete cascade,
  name             text,
  firmware_version text,
  paired_at        timestamptz
);

-- On-device profile slots (Story 7: multiple people per box).
create table if not exists public.device_profiles (
  id            uuid primary key default gen_random_uuid(),
  device_id     text references public.devices (id) on delete cascade,
  slot          text,
  user_id       uuid references public.profiles (id) on delete set null,
  led_signature text
);

-- One-time pairing codes for claiming a device from the app (Story 14).
create table if not exists public.device_pairing_codes (
  code       text primary key,
  device_id  text references public.devices (id) on delete cascade,
  expires_at timestamptz,
  used       bool default false
);

-- Latest telemetry snapshot per device (Story 15/17).
create table if not exists public.device_status (
  device_id     text primary key references public.devices (id) on delete cascade,
  state         text,
  battery_pct   int,
  wifi_rssi     int,
  sensor_health jsonb,
  updated_at    timestamptz default now()
);

-- Focus sessions. device_id is plain text (no FK) so the device can upload
-- before it has been "claimed". unique(device_id, id) is the idempotency
-- target for batched offline sync (Story 4 / Step 3).
create table if not exists public.sessions (
  id                    uuid primary key default gen_random_uuid(),
  device_id             text,
  user_id               uuid references public.profiles (id) on delete cascade,
  slot                  text,
  started_at            timestamptz,
  ended_at              timestamptz,
  target_duration_sec   int,
  actual_focus_sec      int,
  mode                  text,
  status                text,
  breaks                int default 0,
  presence_interruptions int default 0,
  noise_avg             real,
  temp_c                real,
  light_lux             real,
  focus_load_avg        int,
  client_seq            bigint,
  created_at            timestamptz default now(),
  unique (device_id, id)
);

-- Per-minute focus-load estimate samples (Story 10).
create table if not exists public.focus_load_samples (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions (id) on delete cascade,
  t_sec      int,
  value      int
);

-- Per-minute environmental samples (Story 8).
create table if not exists public.env_samples (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions (id) on delete cascade,
  t_sec      int,
  noise      real,
  temp_c     real,
  light_lux  real
);

-- Friend graph for the leaderboard (Story 6).
create table if not exists public.friendships (
  user_id   uuid references public.profiles (id) on delete cascade,
  friend_id uuid references public.profiles (id) on delete cascade,
  status    text default 'pending',
  primary key (user_id, friend_id)
);

-- Reviewer read-only access grants (Story 13).
create table if not exists public.reviewer_grants (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid references public.profiles (id) on delete cascade,
  reviewer_email   text,
  reviewer_user_id uuid references public.profiles (id) on delete set null,
  token            text unique,
  status           text default 'pending',
  expires_at       timestamptz,
  created_at       timestamptz default now()
);

-- Per-user app settings (Story 12 + general).
create table if not exists public.user_settings (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  notifications_enabled bool default true,
  haptics_enabled       bool default true,
  share_with_reviewers  bool default false,
  reduce_motion         bool default false,
  quiet_hours_start     time,
  quiet_hours_end       time
);

-- ---------------------------------------------------------------------------
-- 2. Indexes (foreign keys + common lookups)
-- ---------------------------------------------------------------------------
create index if not exists idx_devices_owner          on public.devices (owner_user_id);
create index if not exists idx_device_profiles_device on public.device_profiles (device_id);
create index if not exists idx_device_profiles_user   on public.device_profiles (user_id);
create index if not exists idx_pairing_codes_device   on public.device_pairing_codes (device_id);
create index if not exists idx_sessions_user          on public.sessions (user_id);
create index if not exists idx_sessions_user_started  on public.sessions (user_id, started_at);
create index if not exists idx_focus_samples_session  on public.focus_load_samples (session_id);
create index if not exists idx_env_samples_session    on public.env_samples (session_id);
create index if not exists idx_friendships_friend     on public.friendships (friend_id);
create index if not exists idx_reviewer_owner         on public.reviewer_grants (owner_user_id);
create index if not exists idx_reviewer_reviewer      on public.reviewer_grants (reviewer_user_id);

-- ---------------------------------------------------------------------------
-- 3. Enable Row-Level Security on every table
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.devices             enable row level security;
alter table public.device_profiles     enable row level security;
alter table public.device_pairing_codes enable row level security;
alter table public.device_status       enable row level security;
alter table public.sessions            enable row level security;
alter table public.focus_load_samples  enable row level security;
alter table public.env_samples         enable row level security;
alter table public.friendships         enable row level security;
alter table public.reviewer_grants     enable row level security;
alter table public.user_settings       enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Table privileges (RLS still gates every row; anon gets nothing)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Policies
--    Writes from the device/ingestion run via the service-role key, which
--    bypasses RLS, so we only need policies for app (authenticated) access.
-- ---------------------------------------------------------------------------

-- profiles: own row only
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- devices: device owner only
drop policy if exists devices_owner_all on public.devices;
create policy devices_owner_all on public.devices
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- device_profiles: anyone who owns the parent device
drop policy if exists device_profiles_owner_all on public.device_profiles;
create policy device_profiles_owner_all on public.device_profiles
  for all to authenticated
  using (
    device_id in (select id from public.devices where owner_user_id = auth.uid())
  )
  with check (
    device_id in (select id from public.devices where owner_user_id = auth.uid())
  );

-- device_pairing_codes: owner of the parent device (claiming itself is server-side)
drop policy if exists device_pairing_codes_owner_all on public.device_pairing_codes;
create policy device_pairing_codes_owner_all on public.device_pairing_codes
  for all to authenticated
  using (
    device_id in (select id from public.devices where owner_user_id = auth.uid())
  )
  with check (
    device_id in (select id from public.devices where owner_user_id = auth.uid())
  );

-- device_status: owner can read (telemetry is written via service role)
drop policy if exists device_status_owner_select on public.device_status;
create policy device_status_owner_select on public.device_status
  for select to authenticated
  using (
    device_id in (select id from public.devices where owner_user_id = auth.uid())
  );

-- sessions: owner full access
drop policy if exists sessions_owner_all on public.sessions;
create policy sessions_owner_all on public.sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- sessions: reviewers get SELECT only, while an active, unexpired grant links
-- the session's owner to the reviewer. No write policies => writes denied.
drop policy if exists sessions_reviewer_select on public.sessions;
create policy sessions_reviewer_select on public.sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.reviewer_grants g
      where g.owner_user_id = sessions.user_id
        and g.reviewer_user_id = auth.uid()
        and g.status = 'active'
        and (g.expires_at is null or g.expires_at > now())
    )
  );

-- focus_load_samples: owner full access via parent session
drop policy if exists focus_samples_owner_all on public.focus_load_samples;
create policy focus_samples_owner_all on public.focus_load_samples
  for all to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = focus_load_samples.session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = focus_load_samples.session_id and s.user_id = auth.uid()
    )
  );

-- focus_load_samples: reviewer SELECT via the parent session's owner grant
drop policy if exists focus_samples_reviewer_select on public.focus_load_samples;
create policy focus_samples_reviewer_select on public.focus_load_samples
  for select to authenticated
  using (
    exists (
      select 1
      from public.sessions s
      join public.reviewer_grants g on g.owner_user_id = s.user_id
      where s.id = focus_load_samples.session_id
        and g.reviewer_user_id = auth.uid()
        and g.status = 'active'
        and (g.expires_at is null or g.expires_at > now())
    )
  );

-- env_samples: owner full access via parent session
drop policy if exists env_samples_owner_all on public.env_samples;
create policy env_samples_owner_all on public.env_samples
  for all to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = env_samples.session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = env_samples.session_id and s.user_id = auth.uid()
    )
  );

-- env_samples: reviewer SELECT via the parent session's owner grant
drop policy if exists env_samples_reviewer_select on public.env_samples;
create policy env_samples_reviewer_select on public.env_samples
  for select to authenticated
  using (
    exists (
      select 1
      from public.sessions s
      join public.reviewer_grants g on g.owner_user_id = s.user_id
      where s.id = env_samples.session_id
        and g.reviewer_user_id = auth.uid()
        and g.status = 'active'
        and (g.expires_at is null or g.expires_at > now())
    )
  );

-- friendships: a user can see/manage rows they are part of
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists friendships_update on public.friendships;
create policy friendships_update on public.friendships
  for update to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid())
  with check (user_id = auth.uid() or friend_id = auth.uid());

drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

-- reviewer_grants: owner manages; reviewer can read grants addressed to them.
-- (Accepting an invite is done server-side in Step 5.)
drop policy if exists reviewer_grants_owner_all on public.reviewer_grants;
create policy reviewer_grants_owner_all on public.reviewer_grants
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists reviewer_grants_reviewer_select on public.reviewer_grants;
create policy reviewer_grants_reviewer_select on public.reviewer_grants
  for select to authenticated
  using (reviewer_user_id = auth.uid());

-- user_settings: own row only
drop policy if exists user_settings_owner_all on public.user_settings;
create policy user_settings_owner_all on public.user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. New-user trigger: auto-create profiles + user_settings rows
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for users that may have been created BEFORE the trigger existed.
insert into public.profiles (id, email, display_name)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

insert into public.user_settings (user_id)
select u.id
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Leaderboard RPC (Story 6)
--    SECURITY DEFINER so it can aggregate across the caller's friends without
--    exposing their raw session rows. Only returns derived stats.
--    "minutes_this_week" = focus minutes since the start of the ISO week.
--    "streak" = consecutive days (ending today or yesterday) with >= 1 session.
-- ---------------------------------------------------------------------------
create or replace function public.get_leaderboard()
returns table (
  rank int,
  display_name text,
  minutes_this_week int,
  streak int,
  is_you bool
)
language sql
security definer
set search_path = public
as $$
  with members as (
    select auth.uid() as id
    union
    select case when f.user_id = auth.uid() then f.friend_id else f.user_id end
    from public.friendships f
    where (f.user_id = auth.uid() or f.friend_id = auth.uid())
      and f.status = 'accepted'
  ),
  week_minutes as (
    select s.user_id,
      round(sum(coalesce(s.actual_focus_sec, 0)) / 60.0)::int as minutes
    from public.sessions s
    where s.user_id in (select id from members)
      and s.started_at >= date_trunc('week', now())
    group by s.user_id
  ),
  session_days as (
    select distinct s.user_id, (s.started_at)::date as d
    from public.sessions s
    where s.user_id in (select id from members)
      and s.started_at is not null
  ),
  islands as (
    select user_id, d,
      d - (row_number() over (partition by user_id order by d))::int as grp
    from session_days
  ),
  island_len as (
    select user_id, grp, count(*)::int as len, max(d) as last_day
    from islands
    group by user_id, grp
  ),
  current_streaks as (
    select distinct on (user_id) user_id, len, last_day
    from island_len
    order by user_id, last_day desc
  ),
  streaks as (
    select user_id,
      case when last_day >= current_date - 1 then len else 0 end as streak
    from current_streaks
  ),
  scored as (
    select
      p.display_name,
      coalesce(wm.minutes, 0) as minutes_this_week,
      coalesce(st.streak, 0) as streak,
      (m.id = auth.uid()) as is_you
    from members m
    join public.profiles p on p.id = m.id
    left join week_minutes wm on wm.user_id = m.id
    left join streaks st on st.user_id = m.id
  )
  select
    (row_number() over (order by minutes_this_week desc, streak desc))::int as rank,
    display_name,
    minutes_this_week::int,
    streak::int,
    is_you
  from scored
  order by rank;
$$;

revoke all on function public.get_leaderboard() from public, anon;
grant execute on function public.get_leaderboard() to authenticated;
