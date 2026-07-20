# Feature: device

MindBox pairing + the firmware↔server bridge.

- `ingest.server.ts` — `/ingest/*` handlers: sessions, telemetry, pairing, **unpair**, **homework**,
  and `GET config` (settings downlink). Dispatched from `src/server.ts`. This is the contract the
  ESP32 firmware calls. Session payloads accept an **optional** `companions` (`"solo"|"with_others"`).
  - **Config downlink** (paired): settings + `agendaStr` (today, `"startMin|endMin|kind|title;…"`,
    kind 0=class 1=exam 2=study, ≤12 items) + `weekStr` (days +1..+6 for the box's Today-screen
    day paging, `"dayOffset|start|end|kind|title;…"`, ≤36 items / ≤10 per day), `tzOffsetMin`,
    sound config (`soundEnabled`/`soundLevel`/
    `chimeMask`/`autoStartEnabled`, migration `0022`), and — migrations `0024`/`0025` —
    `themeId` (accent preset 0-4), `focusMin`/`breakMin`/`timingRev` (adopt-once-per-revision pomodoro
    timing), `examMode`/`nextExamDays`/`nextExamTitle` (DND rule: manual OR exam-today, derived in
    `exam-encode.ts`), `streakDays`/`weekFocusMin` (server-computed, 45-day window), `hwStr`
    (top-3 pending homework `"uuid|title|pct;…"`), and ONE remote command per poll
    (`cmdId`/`cmdType`/`cmdArg`/`cmdText`; box acks via `&ack=<id>` on its next GET; un-acked
    re-served after 75s, expired after 10min).
  - **Telemetry** upserts `device_status` incl. optional room fields (`tempC`/`humidityPct`/
    `lightLux`/`noiseDb`) + `firmware_version`. `updated_at` older than 90s ⇒ offline
    (`freshness.ts`). **`POST /ingest/homework`** lets the box bump `progress_pct` (owner re-verified;
    100% ⇒ `pending → submitted`).
- **Pure encoder/derivation modules** (unit-tested in `src/lib/__tests__/`): `device-string.ts`
  (shared sanitizer + UTF-8 byte cap — EVERY downlink string must pass through it; the firmware's
  naive jStr reader dies on quotes/backslashes), `agenda-encode.ts`, `command-encode.ts` (wire codes
  = firmware CmdType: start 1, end 4, ring 5, message 6; text ≤40B), `homework-encode.ts`,
  `theme-presets.ts` (site mirror of firmware `Theme.cpp` ACCENTS — sync BY ID), `exam-encode.ts`,
  `freshness.ts`.
- `commands.functions.ts` — `sendDeviceCommand` server fn (owner-checked, backpressure ≥5 pending);
  rows live in `device_commands` (0024, browser reads via SELECT-only RLS).
  `queries.ts` — `useMyDevice`, `useRecentDeviceCommands` (Queued→Sent→Done/Expired chips, 5s poll).
- `pairing.functions.ts` — claim / unlink / rename server fns. `web-bluetooth.ts` — BLE Wi-Fi
  provisioning. `sensor-health.ts` — health summary.
- `components/`: `BluetoothConnectCard`, `RemoteControlCard` (start/end/ring/message + recent list,
  on `/device`).
- Downlink/commands test without hardware: `bun run simulate -- --config | --send-command=… |
--ack=… | --homework=…` (see scripts/simulator.ts header).

Shared used: `@/lib/supabase`, `@/lib/queries/settings` ("MindBox device" card on `/settings` edits
sound/theme/timing/exam), `@/lib/streak` (`computeStreakFromDateKeySet`),
`@/components/{StateBadge,LowBatteryBanner}`.
