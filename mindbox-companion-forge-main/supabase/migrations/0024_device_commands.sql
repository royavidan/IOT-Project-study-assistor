-- 0024: Remote commands & messages (site -> device).
-- The /device page enqueues commands (start/end session, ring, message); the
-- box receives ONE pending command per config poll (GET /ingest/config) and
-- acks it on its next poll via `&ack=<id>`. Lifecycle:
--   created_at (queued) -> served_at (put into a config response)
--   -> delivered_at (device acked). Undelivered commands expire after 10 min
-- (enforced in the serve query, not here).
--
-- Writes go through the service-role client only (server fn checks device
-- ownership first — same pattern as pairing). The browser gets a SELECT-only
-- RLS policy so the /device page can show Queued/Sent/Done chips.

create table if not exists public.device_commands (
  id           bigint generated always as identity primary key,
  device_id    text not null references public.devices (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  type         text not null check (type in ('start', 'end', 'ring', 'message')),
  arg          integer,
  text         text,
  created_at   timestamptz not null default now(),
  served_at    timestamptz,
  delivered_at timestamptz
);

create index if not exists idx_device_commands_pending
  on public.device_commands (device_id, created_at)
  where delivered_at is null;

alter table public.device_commands enable row level security;

grant select on public.device_commands to authenticated;

drop policy if exists device_commands_owner_select on public.device_commands;
create policy device_commands_owner_select on public.device_commands
  for select to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
