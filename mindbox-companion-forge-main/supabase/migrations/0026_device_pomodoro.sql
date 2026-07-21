-- 0026: full pomodoro rhythm pushed to the box (site -> device).
--
-- Extends the F1b timing model (device_focus_min/device_break_min, migration
-- 0025) with the two fields the device's own session model has but the site
-- couldn't set: a long break and how many focus blocks precede it. All four
-- ride the SAME `device_timing_updated_at` revision — a change to any of them
-- bumps the downlink `timingRev`, and the box adopts them once per revision
-- (on-box spinner edits are not stomped every poll).

alter table public.user_settings
  add column if not exists device_long_break_min smallint not null default 15
    check (device_long_break_min between 1 and 60),
  add column if not exists device_cycles smallint not null default 4
    check (device_cycles between 1 and 8);

notify pgrst, 'reload schema';
