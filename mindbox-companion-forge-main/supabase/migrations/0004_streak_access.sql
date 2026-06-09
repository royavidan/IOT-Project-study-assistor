-- Restrict get_focus_streak to the caller's own user id or an active reviewer grant.
create or replace function public.get_focus_streak(p_user_id uuid default auth.uid())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(p_user_id, auth.uid());
  streak_len int := 0;
  last_session_day date;
begin
  if target is null then
    return 0;
  end if;

  if target is distinct from auth.uid() then
    if not exists (
      select 1
      from public.reviewer_grants g
      where g.owner_user_id = target
        and g.reviewer_user_id = auth.uid()
        and g.status = 'active'
        and (g.expires_at is null or g.expires_at > now())
    ) then
      return 0;
    end if;
  end if;

  select max((s.started_at)::date) into last_session_day
  from public.sessions s
  where s.user_id = target and s.started_at is not null;

  if last_session_day is null or last_session_day < current_date - 1 then
    return 0;
  end if;

  with session_days as (
    select distinct (s.started_at)::date as d
    from public.sessions s
    where s.user_id = target and s.started_at is not null
  ),
  islands as (
    select d, d - (row_number() over (order by d))::int as grp
    from session_days
  ),
  island_len as (
    select grp, count(*)::int as len, max(d) as last_day
    from islands
    group by grp
  )
  select il.len into streak_len
  from island_len il
  order by il.last_day desc
  limit 1;

  return coalesce(streak_len, 0);
end;
$$;

revoke all on function public.get_focus_streak(uuid) from public, anon;
grant execute on function public.get_focus_streak(uuid) to authenticated;
