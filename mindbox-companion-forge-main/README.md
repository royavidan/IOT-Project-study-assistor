# MindBox Companion

Web companion app for the MindBox focus device (TanStack Start + React + Supabase).

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in the values (Supabase URL/keys, app URL, device ingest secret).
3. Apply the database schema in the Supabase SQL Editor, in order:
   - `supabase/migrations/0001_init.sql` (tables, RLS, leaderboard RPC)
   - `supabase/migrations/0002_app_features.sql` (adaptive-coaching column + friend RPCs)
   - `supabase/migrations/0003_app_gaps.sql` (streak RPC, reviewer students, weekly share)
   - `supabase/migrations/0004_streak_access.sql` (secure streak RPC for reviewers)

   Then reload the API cache by running `NOTIFY pgrst, 'reload schema';` once.
   The **Settings**, **Friends**, **Insights**, reviewer picker, and weekly email require `0002`–`0004`.
4. Start the dev server: `npm run dev` (serves `http://localhost:8080`).

## Tests

`npm run test` runs the Vitest unit suite (pure logic: Focus Load heuristic +
report/CSV serialization). `npm run test:watch` for watch mode.

> After changing **secrets** in `.env`, fully restart `npm run dev` — the dev
> server only reads `process.env` at startup.

## Device simulator

`scripts/simulator.ts` pretends to be a MindBox device so you can populate data
and exercise the app **without hardware**. It POSTs to the `/ingest/*` endpoints
using `DEVICE_INGEST_SECRET` and seeds a device owned by your app user, so the
data shows up on your dashboard/history.

**The dev server must be running first** (`npm run dev`).

```bash
# Seed a device + ~30 days of sessions, then stream telemetry (Ctrl+C to stop)
npm run simulate

# Scenarios
npm run simulate -- --offline-then-sync   # buffer sessions, then sync in one batch
npm run simulate -- --low-battery         # battery drains past 15% then 5%
npm run simulate -- --sensor-fault        # a sensor reports "invalid", state -> danger

# Handy options
npm run simulate -- --user=you@example.com  # attribute device to this user (default: first user)
npm run simulate -- --device=mindbox-sim-01 # device id
npm run simulate -- --seed-only             # seed + post sessions, then exit
npm run simulate -- --no-sessions           # telemetry only
npm run simulate -- --ticks=10 --interval=2000
```

Session IDs are deterministic (hashed from device + day + index), so the
ingestion upsert is idempotent — **re-running the simulator never creates
duplicate sessions**.

To remove simulator seed data and start with a clean dashboard:

```bash
npm run cleanup
```

Requires Node 18+ (run via `tsx`). On Node 22.18+ you can also run
`node scripts/simulator.ts` directly.
