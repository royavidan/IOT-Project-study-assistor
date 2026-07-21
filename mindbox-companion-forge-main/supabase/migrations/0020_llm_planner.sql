-- 0020: LLM planner metadata — what the last generated plan was based on.
-- `last_plan_fingerprint` is a stable hash of the schedule + homework facts;
-- when the live data hashes differently the plan is stale and the UI offers
-- to regenerate. `last_plan_meta` records engine/summary/assumptions for the
-- preview + demo. Run by hand in the Supabase SQL editor.

alter table public.user_settings
  add column if not exists last_plan_fingerprint text,
  add column if not exists last_plan_generated_at timestamptz,
  add column if not exists last_plan_meta jsonb;

notify pgrst, 'reload schema';
