-- ===========================================================================
-- MindBox — session activity context: who you studied with
-- Powers the difficulty-aware "study strain" drain weighting (study-strain.ts).
-- Nullable; the app treats null/unset as "solo". Activity type reuses the
-- existing sessions.mode column ("Homework" is a new allowed value — no schema
-- change needed there).
-- Run after 0001–0018, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

alter table public.sessions
  add column if not exists companions text;
