# MindBox web app — map

TanStack Start (React) + Supabase. **To work on one feature, open its `src/features/<domain>/` folder**;
open `src/lib` only for cross-cutting concerns. Routes are file-based in `src/routes/` (file path = URL) —
they stay thin and import from features.

## Features (`src/features/<x>/`) — open one in isolation
| Feature | Owns | Route(s) |
|---|---|---|
| **device/** | pairing, BLE provisioning, the **ingest API** (firmware↔server), device query, sensor-health | `/device` |
| **insights/** | analytics (`insights.ts`), external-load, charts, wellbeing panel | `/insights`, dashboard |
| **schedule/** | calendar logic, schedule query, event/timeline/course dialogs | `/calendar` |
| **reports/** | export + PDF/email report pipeline, report-email server fn | `/exports` |
| **simulator/** | dev simulator env + server fn | `/simulator` |
| **social/** | friends, leaderboard, reviewers (queries + server fns + invite/notify emails) | `/friends`, `/leaderboard`, `/reviewers` |
| **sessions/** | single-session detail query + delete dialog | `/session/$id`, `/history` |

A feature folder may hold `queries.ts`, `*.functions.ts` (server fns), domain `.ts`, and `components/`.

## Shared — cross-cutting, used by the shell + many features (stays in `src/lib` + `src/components`)
- **Data/auth:** `lib/supabase/*`, `lib/auth/*`.
- **Core queries (used by `AppShell` + many routes):** `lib/queries/sessions.ts`, `lib/queries/settings.ts`.
- **Core domain:** `lib/{focus-load,session-scope,streak,wellbeing,quiet-hours,dates,types,utils}.ts`,
  `lib/feature-flags.ts`, `lib/config.server.ts`, error helpers.
- **Email transport:** `lib/email/send-html.server.ts` (used by both reports + social).
- **UI:** `components/ui/*` (shadcn) + shared layout/leaf components `AppShell`, `PageHeader`, `EmptyState`,
  `InfoHint`, `StateBadge`, `LowBatteryBanner`, `MotivationNudgeBanner`, `ReduceMotionRoot`,
  `StudentScopePicker`; `hooks/*`. Tests live in `lib/__tests__/`.

## Device ↔ server contract (the only firmware overlap)
`src/features/device/ingest.server.ts` handles `POST /ingest/sessions|telemetry|pairing|unpair` and
`GET /ingest/config` (settings downlink), dispatched from `src/server.ts`. Firmware side lives in the
`MindBox - hardware/` repo (`Cloud.cpp`).

## Commands
`bun run dev | build | test | lint` (bun is canonical — `bun.lock`). Without bun: `npx vite dev`,
`npx vite build`, `npx vitest run`, `npx eslint .`.
