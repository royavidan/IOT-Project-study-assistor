-- ===========================================================================
-- MindBox — schedule: meeting subtype (lecture / tutorial / lab)
-- Lets a single course hold several meetings of different kinds.
-- Run after 0001–0008, then: NOTIFY pgrst, 'reload schema';
-- ===========================================================================

alter table public.schedule_events
  add column if not exists subtype text;
