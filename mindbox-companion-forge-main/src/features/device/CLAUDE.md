# Feature: device

MindBox pairing + the firmware↔server bridge.
- `ingest.server.ts` — `/ingest/*` handlers: sessions, telemetry, pairing, **unpair**, and `GET config`
  (settings downlink). Dispatched from `src/server.ts`. This is the contract the ESP32 firmware calls.
- `pairing.functions.ts` — claim / unlink / rename server fns. `queries.ts` — `useMyDevice`.
  `web-bluetooth.ts` — BLE Wi-Fi provisioning. `sensor-health.ts` — health summary.
- `components/BluetoothConnectCard`.

Shared used: `@/lib/supabase`, `@/lib/queries/settings`, `@/components/{StateBadge,LowBatteryBanner}`.
