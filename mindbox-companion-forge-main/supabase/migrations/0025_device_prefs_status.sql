-- 0025: Device prefs (site -> box) + richer live status (box -> site).
--
-- user_settings:
--   device_theme_id          — accent-preset index for the box UI (mirrors the
--                              firmware's Theme ACCENTS[5] table; 0 = Signal Red).
--   device_focus_min/break_min + device_timing_updated_at — pomodoro timing set
--                              on the site. The timestamp becomes the downlink
--                              `timingRev`: the box adopts the values exactly
--                              once per site-save (revision-gated), so on-box
--                              spinner edits are not stomped every poll.
--   exam_mode                — manual DND toggle; the effective downlink value
--                              is (manual OR exam-today-in-agenda).
--
-- device_status: current room conditions + firmware version, refreshed by every
-- telemetry push (30s). Null = the firmware doesn't have that sensor / predates
-- this field.

alter table public.user_settings
  add column if not exists device_theme_id smallint not null default 0
    check (device_theme_id between 0 and 4),
  add column if not exists device_focus_min smallint not null default 25
    check (device_focus_min between 5 and 120),
  add column if not exists device_break_min smallint not null default 5
    check (device_break_min between 1 and 60),
  add column if not exists device_timing_updated_at timestamptz,
  add column if not exists exam_mode boolean not null default false;

alter table public.device_status
  add column if not exists temp_c real,
  add column if not exists humidity_pct real,
  add column if not exists light_lux real,
  add column if not exists noise_db real,
  add column if not exists firmware_version text;

notify pgrst, 'reload schema';
