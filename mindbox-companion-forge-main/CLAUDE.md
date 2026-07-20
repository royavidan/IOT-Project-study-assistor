# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# MindBox web app — map

TanStack Start (React 19) + Supabase. **To work on one feature, open its `src/features/<domain>/` folder**
— each has its own `CLAUDE.md`. Open `src/lib` only for cross-cutting concerns. Routes are file-based in
`src/routes/` (file path = URL, see `src/routes/README.md`) — they stay thin and import from features.

## Features (`src/features/<x>/`) — open one in isolation (each has a `CLAUDE.md`)

| Feature        | Owns                                                                                         | Route(s)                                 |
| -------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **dashboard/** | the state-aware "Today" home (`today.ts` pure aggregation, onboarding checklist)             | `/`                                      |
| **device/**    | pairing, BLE provisioning, the **ingest API** (firmware↔server), device query, sensor-health | `/device`                                |
| **courses/**   | course entity + per-course roll-up, weighted grade scheme (`grades.ts`), ICS-linked courses  | `/courses`, `/courses/$id`               |
| **schedule/**  | calendar logic, schedule query, event/timeline/course dialogs, ICS import                    | `/calendar`                              |
| **planner/**   | auto-scheduled, burnout-aware study blocks (pure `planner.ts`) — "Auto-plan study time"      | (on `/calendar`)                         |
| **homework/**  | assignment kanban + dialog + `status.ts` (data lives in `lib/queries/homework.ts`)           | `/assignments`                           |
| **insights/**  | analytics (`insights.ts`), external-load, charts, wellbeing panel                            | `/insights`, dashboard                   |
| **sessions/**  | single-session detail query + delete dialog, history view                                    | `/session/$id`, `/history`               |
| **reports/**   | export + PDF/email report pipeline, report-email server fn                                   | `/exports`                               |
| **social/**    | friends, leaderboard, reviewers (queries + server fns + invite/notify emails)                | `/friends`, `/leaderboard`, `/reviewers` |
| **simulator/** | dev simulator env + server fn                                                                | `/simulator`                             |

`/progress` is a cross-feature aggregate route (tabs stitching `sessions` + `insights` + `reports` views);
other unowned routes: `/settings`, `/login`, `/auth/callback`, `/reviewer/accept`.
A feature folder may hold `queries.ts`, `*.functions.ts` (server fns), domain `.ts`, and `components/`.

## Shared — cross-cutting, used by the shell + many features (stays in `src/lib` + `src/components`)

- **Data/auth:** `lib/supabase/*`, `lib/auth/*`.
- **Core queries (used by `AppShell` + many routes):** `lib/queries/{sessions,settings,homework}.ts`.
- **Core domain:** `lib/{focus-load,session-scope,streak,wellbeing,quiet-hours,dates,types,utils}.ts`,
  `lib/feature-flags.ts`, `lib/config.server.ts`, error helpers.
- **Email transport:** `lib/email/send-html.server.ts` (used by both reports + social).
- **UI:** `components/ui/*` (shadcn) + shared layout/leaf components `AppShell`, `PageHeader`, `EmptyState`,
  `InfoHint`, `StateBadge`, `LowBatteryBanner`, `MotivationNudgeBanner`, `ReduceMotionRoot`,
  `StudentScopePicker`; `hooks/*`. Tests live in `lib/__tests__/`.

## Architecture — two data paths, one server entry

`src/server.ts` is the fetch entry. It splits traffic **before** the app router:

- **`/ingest/*`** (`sessions|telemetry|pairing|unpair|config`) → `features/device/ingest.server.ts`. Plain
  HTTP from the ESP32/simulator, authed by the `x-device-secret` header, writes via the **service-role**
  admin client (bypasses RLS). This is the only firmware overlap (firmware side: `MindBox - hardware/` → `Cloud.cpp`).
- **everything else** → TanStack Start SSR + server functions. User data goes through the **request-scoped**
  Supabase client bound to the request's cookies, so **Row-Level Security is enforced**.

Two Supabase clients, never mix them (`lib/supabase/server.ts`):

- `getSupabaseServerClient()` — request-scoped, RLS-enforced. Default for user-facing reads/writes.
- `getSupabaseAdminClient()` — service-role, **bypasses RLS**, server-only. Only for privileged writes
  (device ingest, cross-user lookups in social server fns).

Conventions that the build enforces:

- **`*.server.ts`** imports `@tanstack/react-start/server-only` — Vite fails the build if a client bundle
  ever pulls it in. Keeps the service-role key off the browser.
- **`*.functions.ts`** = `createServerFn` server functions (Zod-validated input, run on the server, called
  like RPC from the client). CSRF middleware (`src/start.ts`) is applied to all server fns.
- **Env access** (`lib/config.server.ts`): read `process.env` _inside_ a function, never at module scope
  (Cloudflare Workers bind env per-request). `SUPABASE_SERVICE_ROLE_KEY` / `DEVICE_INGEST_SECRET` are
  server-only (no `VITE_` prefix). Public config uses `import.meta.env.VITE_*`.

## Database / Supabase

Migrations in `supabase/migrations/` are **applied by hand in the Supabase SQL Editor, in numeric order**
(no CLI migration runner). After applying, reload the API cache once: `NOTIFY pgrst, 'reload schema';`.
After changing `.env` secrets, **fully restart the dev server** — env is read only at startup.

## Commands

`bun run dev | build | test | lint` (bun is canonical — `bun.lock`; dev serves **http://localhost:8080**).
Without bun: `npx vite dev`, `npx vite build`, `npx vitest run`, `npx eslint .`.

- **Single test:** `bun run test <file-or-name>` → e.g. `bun run test focus-load` or
  `npx vitest run src/lib/__tests__/focus-load.test.ts`. Tests are pure-logic units in `lib/__tests__/`.
- **Simulator** (no hardware needed; dev server must be running first): `bun run simulate`
  (scenarios: `-- --offline-then-sync | --low-battery | --sensor-fault`); `bun run cleanup` removes seed data.
- `bun run format` (Prettier).
