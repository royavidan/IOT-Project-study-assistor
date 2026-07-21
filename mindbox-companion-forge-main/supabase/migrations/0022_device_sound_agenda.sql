-- 0022: Website-controlled device sound + scheduled auto-start preferences.
-- Delivered to the box on every GET /ingest/config poll (unlike the
-- first-pair-only settings, these are cloud-owned while paired).
-- chime_mask bits: 0 = session start/pause/resume, 1 = session complete,
-- 2 = scheduled-block auto-start, 3 = environment/interference alert.
-- Run by hand in the Supabase SQL editor.

alter table public.user_settings
  add column if not exists device_sound_enabled boolean not null default true,
  add column if not exists device_sound_level smallint not null default 1
    check (device_sound_level between 0 and 2),
  add column if not exists device_chime_mask smallint not null default 15
    check (device_chime_mask between 0 and 15),
  add column if not exists auto_start_scheduled boolean not null default true;

notify pgrst, 'reload schema';
