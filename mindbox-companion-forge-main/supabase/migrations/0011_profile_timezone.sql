-- ===========================================================================
-- 0011_profile_timezone.sql — store the user's UTC offset so the server can
-- compute "today" in their local day (matching the app dashboard) and hand the
-- today-focus total down to the box via GET /ingest/config.
-- tz_offset_min = minutes AHEAD of UTC (e.g. UTC+2 -> 120). The web app writes it.
-- Run in the Supabase SQL Editor, then it NOTIFYs PostgREST to reload.
-- ===========================================================================

alter table public.profiles
  add column if not exists tz_offset_min int default 0;

notify pgrst, 'reload schema';
