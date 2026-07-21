-- ===========================================================================
-- MindBox — app-feature follow-ups (Step 2)
-- Adds columns the companion app needs that weren't in the initial schema.
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE.
--
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- After running, reload the PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Story 16 — Adaptive Interval Coaching toggle lives in app settings.
-- ---------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists adaptive_coaching_enabled bool default false;

-- ---------------------------------------------------------------------------
-- 2. Story 6 — friend lookup by email.
--    profiles RLS is "own row only", so the browser cannot resolve another
--    user's id from their email to send a friend request. This SECURITY
--    DEFINER RPC exposes ONLY (id, display_name) for an exact email match,
--    never raw profile rows.
-- ---------------------------------------------------------------------------
create or replace function public.find_profile_by_email(p_email text)
returns table (id uuid, display_name text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.display_name
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.find_profile_by_email(text) from public, anon;
grant execute on function public.find_profile_by_email(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Story 6 — list a user's friendships WITH the other party's display name.
--    Again, profiles RLS blocks reading friends' names directly, so this
--    SECURITY DEFINER RPC returns the joined view scoped to the caller.
-- ---------------------------------------------------------------------------
create or replace function public.get_friends()
returns table (
  friend_id    uuid,
  display_name text,
  email        text,
  status       text,
  direction    text  -- 'outgoing' = caller sent it, 'incoming' = caller received it
)
language sql
security definer
set search_path = public
as $$
  select
    case when f.user_id = auth.uid() then f.friend_id else f.user_id end as friend_id,
    p.display_name,
    p.email,
    f.status,
    case when f.user_id = auth.uid() then 'outgoing' else 'incoming' end as direction
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
  where f.user_id = auth.uid() or f.friend_id = auth.uid();
$$;

revoke all on function public.get_friends() from public, anon;
grant execute on function public.get_friends() to authenticated;
