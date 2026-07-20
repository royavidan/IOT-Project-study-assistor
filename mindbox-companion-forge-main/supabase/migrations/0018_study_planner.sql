-- ===========================================================================
-- 0018_study_planner.sql — Study Planner: auto-scheduled study blocks
-- Adds the config the planner reads, an optional per-assignment effort estimate,
-- and a flag marking calendar study blocks that the planner generated (so they
-- can be regenerated without touching hand-made ones).
-- Run in the Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

-- Planner configuration (per user).
alter table public.user_settings
  add column if not exists study_plan_mode text not null default 'balanced';
alter table public.user_settings
  drop constraint if exists user_settings_study_plan_mode_check;
alter table public.user_settings
  add constraint user_settings_study_plan_mode_check
    check (study_plan_mode in ('balanced', 'deep_focus', 'sprint'));

-- Working-hours window the planner may place study blocks in.
alter table public.user_settings
  add column if not exists plan_day_start time not null default '09:00';
alter table public.user_settings
  add column if not exists plan_day_end time not null default '21:00';

-- Optional hard cap (minutes/day) that overrides the mode default. Null = use mode.
alter table public.user_settings
  add column if not exists plan_daily_cap_min int;

-- Optional per-assignment effort estimate (minutes). Null = heuristic from weight.
alter table public.homework_assignments
  add column if not exists estimated_minutes int
    check (estimated_minutes is null or estimated_minutes >= 0);

-- Marks a study block the planner generated (vs. one the user made by hand).
-- Only generated blocks are cleared on regenerate.
alter table public.schedule_events
  add column if not exists plan_generated boolean not null default false;

create index if not exists idx_schedule_events_generated
  on public.schedule_events (user_id, plan_generated)
  where plan_generated;

notify pgrst, 'reload schema';
