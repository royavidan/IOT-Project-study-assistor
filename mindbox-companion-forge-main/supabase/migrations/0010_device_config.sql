-- ===========================================================================
-- 0010_device_config.sql — settings the box pulls down via GET /ingest/config.
-- Adds a device-only display toggle (whether the OLED shows the countdown).
-- The rest of the downlink reuses existing user_settings / profiles columns.
-- Run in the Supabase SQL Editor, then NOTIFY pgrst, 'reload schema';
-- ===========================================================================

alter table public.user_settings
  add column if not exists device_show_timer bool default true;

notify pgrst, 'reload schema';
