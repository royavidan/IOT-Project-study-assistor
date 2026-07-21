-- ===========================================================================
-- MindBox — app gap follow-ups (reviewer students, unified streak, weekly share)
-- Safe to re-run. Run after 0001 + 0002, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

alter table public.user_settings
  add column if not exists last_weekly_share_at timestamptz;

-- ---------------------------------------------------------------------------
-- Unified focus streak (matches src/lib/streak.ts island logic).
-- ---------------------------------------------------------------------------
create or replace function public.get_focus_streak(p_user_id uuid default auth.uid())
returns int
language sql
security definer
set search_path = public
as $$
  with session_days as (
    select distinct (s.started_at)::date as d
    from public.sessions s
    where s.user_id = p_user_id
      and s.started_at is not null
  ),
  islands as (
    select d, d - (row_number() over (order by d))::int as grp
    from session_days
  ),
  island_len as (
    select grp, count(*)::int as len, max(d) as last_day
    from islands
    group by grp
  ),
  current_streak as (
    select len
    from island_len
    order by last_day desc
    limit 1
  )
  select coalesce(
    (
      select case
        when (select max(d) from session_days) >= current_date - 1
          then cs.len
        else 0
      end
      from current_streak cs
    ),
    0
  )::int;
$$;

revoke all on function public.get_focus_streak(uuid) from public, anon;
grant execute on function public.get_focus_streak(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reviewer: list students this user can read (active grants).
-- ---------------------------------------------------------------------------
create or replace function public.get_reviewer_students()
returns table (
  owner_user_id uuid,
  display_name  text,
  email         text
)
language sql
security definer
set search_path = public
as $$
  select
    g.owner_user_id,
    p.display_name,
    p.email
  from public.reviewer_grants g
  join public.profiles p on p.id = g.owner_user_id
  where g.reviewer_user_id = auth.uid()
    and g.status = 'active'
    and (g.expires_at is null or g.expires_at > now())
  order by p.display_name nulls last, p.email;
$$;

revoke all on function public.get_reviewer_students() from public, anon;
grant execute on function public.get_reviewer_students() to authenticated;

-- Reuse the same streak island logic inside get_leaderboard for consistency.
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
