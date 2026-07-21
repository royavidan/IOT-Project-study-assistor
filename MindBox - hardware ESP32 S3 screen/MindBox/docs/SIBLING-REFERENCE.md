# MindBox — Current System Reference (handoff doc)

> ⚠️ **Non-authoritative copy.** This is a snapshot of the *sibling* full-firmware project's system
> reference, kept here for convenience while porting onto the S3 board. The authoritative version
> lives in `../../MindBox - hardware/MindBox/` — defer to it if they disagree.

> Purpose: a complete, accurate map of the MindBox system **as it exists today**, so a fresh
> conversation can understand it and help set up / extend the configuration. This documents the
> current state only — no proposed features. Last mapped from the codebase on 2026-06-10.

---

## 1. What MindBox is

A **student focus system** in two parts:

1. **The box (hardware)** — an ESP32 "smart box" with tactile controls (buttons, rotary encoder,
   SPDT work/break toggle), an LED ring, a vibration motor, an OLED, and environment + presence
   sensors. The user starts/stops focus sessions **on the device** (screen-free by design).
2. **The web companion app** — a TanStack Start + React + Supabase web app that shows history,
   insights, wellbeing patterns, streaks, a leaderboard, reviewer sharing, exports, and a course
   calendar. It is the device's dashboard and configuration surface.

**Design invariant:** sessions are controlled on the box; the app reflects live device state rather
than offering fake start/stop controls.

---

## 2. Repository layout (monorepo, two projects)

```
IOT-Project-study-assistor/
├─ MindBox - hardware/            # ESP32 firmware (Arduino/C++) — separate project
├─ mindbox-companion-forge-main/  # the web app (this document is about this)
└─ CLAUDE.md                      # repo router: "work on one project at a time"
```

The **only cross-project surface** is the device↔server **ingest contract** (Section 7). Each
project has its own `CLAUDE.md`. Legacy/experimental sketches live under `archive/`.

---

## 3. Tech stack (web app)

- **Framework:** TanStack Start (React 19, SSR) + TanStack Router (file-based) + TanStack Query.
- **DB/Auth:** Supabase (Postgres + Row-Level Security + Auth). `@supabase/ssr` for cookie auth.
- **Styling/UI:** Tailwind CSS v4 + shadcn/ui (Radix primitives) + lucide-react icons + recharts.
- **Email:** nodemailer (Gmail SMTP) with a Resend HTTP fallback.
- **PDF:** puppeteer (HTML→PDF) with a pdfkit fallback.
- **Build/tooling:** Vite 7, Nitro server, Vitest, ESLint + Prettier, TypeScript. Package manager:
  bun is canonical (`bun.lock`); npm works too. Dev server runs on **http://localhost:8080**.

---

## 4. Source structure (feature-folder layout)

Routes are thin (`src/routes/`, file path = URL) and import from feature folders.

```
src/
├─ routes/                 # pages: index, history, insights, leaderboard, friends, reviewers,
│                          #        exports, device, simulator, settings, calendar, login,
│                          #        session.$id, auth/callback, reviewer/accept, __root
├─ features/
│  ├─ device/              # ingest.server.ts (firmware↔server API), pairing.functions.ts,
│  │                       # queries.ts (useMyDevice), web-bluetooth.ts (BLE), sensor-health.ts,
│  │                       # components/BluetoothConnectCard
│  ├─ schedule/            # schedule.ts (pure calendar logic), queries.ts, components/
│  │                       # (CourseBuilderDialog, ScheduleEventDialog, ScheduleTimeline)
│  ├─ insights/            # insights.ts (correlations), external-load.ts, components/
│  │                       # (InsightsCharts, WellbeingPanel, ExternalLoadCard)
│  ├─ sessions/            # session-detail.ts, components/DeleteSessionDialog
│  ├─ social/              # friends, leaderboard, reviewer (queries + *.functions.ts + emails)
│  ├─ reports/             # export.ts, print-report.ts, build-report-pdf.server.ts,
│  │                       # deliver-report.server.ts, report-email.functions.ts
│  └─ simulator/           # simulator-env.ts, simulator.functions.ts
├─ lib/
│  ├─ focus-load.ts        # SHARED device↔cloud payload contracts + Focus Load heuristic
│  ├─ wellbeing.ts         # recovery / circadian / routine estimators (+external load)
│  ├─ streak.ts, dates.ts, session-scope.ts, quiet-hours.ts, feature-flags.ts
│  ├─ queries/sessions.ts  # core: useSessions, useTodayStats, useDeviceStatus (used app-wide)
│  ├─ queries/settings.ts  # core: user settings + semester term
│  ├─ api/sessions.functions.ts   # deleteSession server fn
│  ├─ auth/ (auth-context.tsx, google-oauth.ts)
│  ├─ supabase/ (client.ts, server.ts [admin + request clients], types.ts [placeholder])
│  ├─ config.server.ts     # server-only env access
│  └─ email/send-html.server.ts   # sendEmail (SMTP→Resend)
├─ components/             # AppShell, PageHeader, StateBadge, InfoHint, LowBatteryBanner,
│                          # EmptyState, MotivationNudgeBanner, StudentScopePicker, ui/* (shadcn)
├─ server.ts               # entry: routes /ingest/* to the device handler, else SSR
└─ scripts/                # simulator.ts (CLI device stand-in), cleanup-simulator.ts
```

---

## 5. Routes / pages (URL → purpose)

| Route | Purpose |
|---|---|
| `/` | Dashboard — today's focus vs goal, streak, Wi‑Fi, device state, insight teaser, recent sessions |
| `/history` | Session list with date-range filter; reviewer student picker |
| `/insights` | Env↔focus correlations, ideal conditions, time-of-day, hourly heatmap, **Wellbeing panel** |
| `/leaderboard` | Friends' weekly focus minutes + streaks (Top 10 / My rank) |
| `/friends` | Add/accept/remove friends (drives leaderboard); sends notification emails |
| `/reviewers` | Invite a parent/tutor/coach to read-only reports (email + token) |
| `/exports` | CSV/JSON download + print-to-PDF report |
| `/device` | Pair the box (6-digit code), live status, sensor health, BLE connect card |
| `/simulator` | No-hardware stand-in: log sessions + push telemetry from the app |
| `/settings` | Profile, daily goal, toggles (nudges, haptics, adaptive coaching, reduce motion, share),
  quiet hours, **semester term**, external-load card |
| `/calendar` | Course calendar: weekly classes + exams, semester bounding, upcoming-exam countdown |
| `/session/$id` | Single session detail (per-minute focus-load + environment charts) |
| `/login`, `/auth/callback` | Email/password + Google OAuth |
| `/reviewer/accept` | Accept a reviewer invite via token |

Auth gating lives in `src/routes/__root.tsx` (`AuthGate`): public routes = `/login`,
`/reviewer/accept`, `/auth/callback`; everything else redirects to `/login`.

---

## 6. Data model (Supabase / Postgres)

All tables have **Row-Level Security ON**. App (authenticated) access is owner-scoped; the device
ingest path uses the **service-role key** (bypasses RLS). A `handle_new_user()` trigger auto-creates
`profiles` + `user_settings` rows on signup.

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | id (=auth.users), display_name, email, daily_goal_min(180), **tz_offset_min** | 1:1 with auth |
| `devices` | id (text, hardware id), owner_user_id, name, firmware_version, paired_at | |
| `device_profiles` | device_id, slot, user_id, led_signature | on-box profile slots (Story 7) |
| `device_pairing_codes` | code (pk), device_id, expires_at, used | 6-digit, 15-min expiry |
| `device_status` | device_id (pk), state, battery_pct, wifi_rssi, sensor_health(jsonb), updated_at | latest telemetry |
| `sessions` | id, device_id, user_id, slot, started/ended_at, target/actual_focus_sec, mode, status, breaks, presence_interruptions, noise_avg, temp_c, light_lux, focus_load_avg, client_seq | **unique(device_id,id)** = idempotency key |
| `focus_load_samples` | session_id, t_sec, value | per-minute Focus Load |
| `env_samples` | session_id, t_sec, noise, temp_c, light_lux | per-minute environment |
| `friendships` | user_id, friend_id, status(pending/accepted) | pk(user_id,friend_id) |
| `reviewer_grants` | owner_user_id, reviewer_email, reviewer_user_id, token(unique), status, expires_at | read-only sharing |
| `user_settings` | user_id (pk), notifications_enabled, haptics_enabled, share_with_reviewers, reduce_motion, adaptive_coaching_enabled, quiet_hours_start/end, last_weekly_share_at, **semester_label/start/end**, **device_show_timer** | |
| `external_loads` | user_id, label, kind(weekly/dated), hours, date | lectures/labs → Recovery balance |
| `schedule_events` | user_id, title, course_code, location, color, **category(class/exam)**, **subtype(lecture/tutorial/lab)**, kind(weekly/once), day_of_week, event_date, start_time, end_time, notes | the calendar |

**RPCs (SECURITY DEFINER):** `get_leaderboard()`, `find_profile_by_email(text)`, `get_friends()`,
`get_focus_streak(uuid)` (reviewer-guarded), `get_reviewer_students()`.

**RLS pattern:** own-row for everything; **reviewers** get SELECT on `sessions`/`focus_load_samples`/
`env_samples` while an `active`, unexpired `reviewer_grant` links them to the owner.

**Migrations (run in order in the Supabase SQL Editor):**
`0001_init` → `0002_app_features` → `0003_app_gaps` → `0004_streak_access` →
`0005_google_oauth_profile` → `0006_external_load` → `0007_schedule_events` →
`0008_schedule_exams_semester` → `0009_schedule_subtype` → `0010_device_config` →
`0011_profile_timezone`. After running, execute `NOTIFY pgrst, 'reload schema';` once.

> Note: `src/lib/supabase/types.ts` is a **placeholder** (permissive) — not generated. Queries cast
> rows defensively. Regenerate with `supabase gen types typescript` when you have project access.

---

## 7. Device ↔ server contract (THE cross-project surface)

HTTP, dispatched from `src/server.ts` → `src/features/device/ingest.server.ts`. **Auth:** every
request carries header `x-device-secret: <DEVICE_INGEST_SECRET>` (constant-time compare). Payload
TypeScript contracts live in `src/lib/focus-load.ts` (firmware mirrors these).

| Endpoint | Method | Body / query | Effect |
|---|---|---|---|
| `/ingest/sessions` | POST | array of `SessionPayload` | Idempotent upsert on (device_id,id); resolves `user_id` via device_profiles(slot) → device owner; replaces child focus/env samples |
| `/ingest/telemetry` | POST | `TelemetryPayload` | Upserts `device_status` (state, battery, rssi, sensor health) |
| `/ingest/pairing` | POST | `{deviceId, code}` (6 digits) | Box mints a code → stored with 15-min expiry; `/device` page claims it |
| `/ingest/unpair` | POST | `{deviceId}` | Clears device ownership + slots |
| `/ingest/config` | GET | `?deviceId=…` | **Downlink**: paired flag, showTimer, hapticsEnabled, adaptiveCoaching, nudgesEnabled, quietStart/EndMin, dailyGoalMin, **todayFocusSec** (computed in the owner's local day via `tz_offset_min`), ownerDisplayName, ownerEmail. Unpaired → safe defaults |

**`SessionPayload`** (key fields): deviceId, profileId (slot), sessionId (uuid, idempotency key),
clientSeq, startedAt, endedAt, targetDurationSec, actualFocusSec, mode, status, breaks,
presenceInterruptions, env {noiseAvg, noisePeak, tempC, lightLux}, focusLoadSamples[], focusLoadAvg,
envSamples[]?.

**`TelemetryPayload`:** deviceId, ts, state, batteryPct, wifiRssi, sensorHealth, firmwareVersion.

**Focus Load Estimate** (`computeFocusLoad`, `src/lib/focus-load.ts`): a transparent 0–100 heuristic =
`0.3·(elapsed/target) + 0.3·noise + 0.2·lightVariance + 0.2·(presenceInterruptions/5)`. **Always
labeled an "estimate," never clinical/fatigue.**

---

## 8. Web Bluetooth (BLE) contract — scaffold

`src/features/device/web-bluetooth.ts` defines the GATT profile the firmware must expose:
- Service `7a9b0000-3c2d-4e1f-8a6b-0c1d2e3f4a50` with characteristics: `deviceInfo` (…0001, JSON
  deviceId+firmware), `pairingCode` (…0002), `telemetry` (…0003), `wifiConfig` (…0004, write).
- **Support limits:** Web Bluetooth works only in **Chrome/Edge desktop + Android Chrome** — NOT on
  iOS (any browser), Firefox, or Safari. Requires HTTPS + a user gesture. UI feature-detects and
  falls back to Wi‑Fi/code pairing. This is a scaffold; firmware BLE is not implemented yet.

---

## 9. Core domain logic

- **Wellbeing** (`src/lib/wellbeing.ts`): `computeWellbeing(sessions, externalLoad)` → three
  behavioral-pattern estimators — **Recovery balance** (rest days, late-night load, load-vs-prior;
  folds in external commitments), **Circadian alignment** (best window, late-night share),
  **Routine consistency** (circular stats on daily start times). Explicitly **non-clinical**;
  confidence scales with data volume.
- **Insights** (`features/insights/insights.ts`): Pearson env↔focus correlations, ideal conditions
  (top-quartile), time-of-day buckets, hourly heatmap, dashboard teaser.
- **Schedule** (`features/schedule/schedule.ts`): pure helpers — `expandScheduleEvents` (weekly +
  one-off; semester-bounded), `buildDayAgenda` (merge courses + focus sessions), `buildCourseEvents`
  (one course → many meetings + exams), `upcomingExams`/`countdownLabel`, `meetingTypeLabel`.
- **Streak/dates/scope:** `streak.ts` (consecutive-day streak, mirrors SQL), `dates.ts` (local
  date-key helpers), `session-scope.ts` (own vs reviewed-student filtering), `quiet-hours.ts`.

---

## 10. Auth, email, and feature flags

- **Auth:** Supabase email/password **and Google OAuth** (configured in the Supabase dashboard, not
  app env). `/auth/callback` completes OAuth; `auth/google-oauth.ts` + `auth-context.tsx` manage it.
- **Email** (`src/lib/email/send-html.server.ts`): `sendEmail()` prefers **Gmail SMTP** (when
  `SMTP_USER`+`SMTP_PASS` set) and falls back to **Resend** (`RESEND_API_KEY`). Used by friend
  notifications, reviewer invites, and PDF report delivery. SMTP needs a Gmail **App Password**.
- **Battery is intentionally hidden** via `src/lib/feature-flags.ts` (`BATTERY_TRACKING_ENABLED =
  false`) — there is no real battery telemetry source yet, so battery UI is gated off everywhere.

---

## 11. Environment variables (`.env`, gitignored)

| Var | Purpose |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Public Supabase (browser, RLS-protected) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only; service-role bypasses RLS (ingest) |
| `APP_BASE_URL` | Public app URL for email links + OAuth redirects (default `http://localhost:8080`) |
| `DEVICE_INGEST_SECRET` | Shared secret the box/simulator send as `x-device-secret` |
| `SMTP_HOST/PORT/USER/PASS/FROM` (+`SMTP_SECURE`) | Gmail (or any SMTP) email — primary transport |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional email fallback |

Google OAuth client ID/secret go in the **Supabase dashboard** (Authentication → Providers →
Google), with the redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` in Google Cloud.

---

## 12. Setup & run

1. `npm install` (or `bun install`).
2. Copy `.env.example` → `.env`; fill Supabase keys, `DEVICE_INGEST_SECRET`, and email (SMTP).
3. In the Supabase SQL Editor, run migrations `0001`…`0011` **in order**, then
   `NOTIFY pgrst, 'reload schema';`.
4. (Optional) Configure Google provider in the Supabase dashboard.
5. `npm run dev` → http://localhost:8080.

**Commands:** `dev | build | test | lint | format`, plus `npm run simulate` (CLI device stand-in)
and `npm run cleanup` (remove simulator seed data). Tests are Vitest unit tests over pure logic
(focus-load, wellbeing, insights, export, schedule, streak, dates, quiet-hours, etc.).

---

## 13. Simulator (no hardware needed)

- **In-app** `/simulator` page (`features/simulator/simulator.functions.ts`): seed a device owned by
  your user, log sessions, push telemetry — data shows on your dashboard/history.
- **CLI** `scripts/simulator.ts` (`npm run simulate`): POSTs to `/ingest/*` with the shared secret;
  ~30 days of deterministic sessions (idempotent), plus scenarios `--offline-then-sync`,
  `--low-battery`, `--sensor-fault`. Dev server must be running first.

---

## 14. Key invariants & current limitations (read before extending)

- **Device-first:** sessions originate on the box; the app never fakes start/stop.
- **Focus Load Estimate & Wellbeing are transparent heuristics**, never labeled clinical/diagnostic
  (Story 10 rule). Keep any new derived metric the same.
- **Ingest is idempotent** on `(device_id, id)` and supports offline batch sync.
- **Reviewers are read-only** (enforced by RLS — no write policies for them).
- **Battery telemetry is disabled** (flag) until a real source exists.
- **On-device profiles (Story 7):** `device_profiles.slot → user_id` exists in the schema and the
  ingest resolver, but there is **no app UI** to assign slots — so multi-user-per-box sessions
  currently fall back to the device owner.
- **BLE is a scaffold**; no physical firmware yet — the simulator is the hardware stand-in.
- **Supabase types are placeholder** (not generated) — expect defensive casting in queries.
- Lint line-endings are normalized via `.prettierrc` `endOfLine:"auto"` + `.gitattributes`.

---

## 15. Where to look first (quick index)

- Firmware↔server API: `src/features/device/ingest.server.ts` + contracts in `src/lib/focus-load.ts`.
- App-wide data: `src/lib/queries/sessions.ts`, `src/lib/queries/settings.ts`.
- Calendar/courses: `src/features/schedule/`.
- Insights/wellbeing: `src/features/insights/` + `src/lib/wellbeing.ts`.
- DB shape: `supabase/migrations/0001_init.sql` (+ later numbered migrations for added columns).
- Setup truth: `.env.example` + the web app's `CLAUDE.md`.
