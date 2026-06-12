# MindBox firmware — subsystem map

ESP32 (DOIT DevKit V1) Arduino sketch. **Flat by necessity** — Arduino compiles every source in this one
sketch folder, so the files can't be foldered. Use this map to open only what a task needs instead of
scanning all ~30 files. Full design notes live in `ARCHITECTURE.md`.

## Subsystems — read only what you need
| Subsystem | Files |
|---|---|
| **Core / FSM** | `MindBox.ino`, `StateMachine.*`, `Session.*`, `types.h`, `config.h` |
| **Persistence (NVS)** | `Storage.*`, `UploadQueue.*` |
| **Networking** | `Cloud.*`, `Payload.*` (uploads drain through `UploadQueue`) |
| **UI / render** | `Display.*`, `Menu.*`, `LedRing.*` |
| **Sensing / input / haptics** | `Sensors.*`, `Inputs.*`, `focus_load.h`, `Haptics.*` |
| **Diagnostics** | `Diagnostics.*` |

## Threading model (critical — don't break this)
- Arduino `loop()` runs on **core 1**: input, FSM, sensors, OLED render (`StateMachine::tick` →
  `Display::render`).
- `Cloud::begin()` spawns a **net task on core 0** (`cloudTask`): all Wi-Fi / HTTP / telemetry / upload.
- They share state ONLY through thread-safe shims: `Cloud::publishState` / `takeSettings` / `nextCommand`,
  the LittleFS-backed `UploadQueue`, and `Storage`'s **recursive NVS mutex**. NVS/Preferences is not
  thread-safe — every public `Storage::` function takes that lock; never add raw `prefs.` access elsewhere.
- The loop-task watchdog uses `trigger_panic = true`, so a stalled/blocking loop reboots the box.

## Device ↔ server contract (the only web-app overlap)
The box calls the web app's ingest API (base URL + `x-device-secret` stored in NVS, provisioned over the
serial `w` command): `POST /ingest/sessions|telemetry|pairing|unpair` and `GET /ingest/config` (the
settings downlink). Firmware side is in `Cloud.cpp` (`Payload.cpp` builds the JSON); the server side is the
web app's `src/features/device/ingest.server.ts`.

## Build / flash
Arduino IDE with the ESP32 core; board = DOIT ESP32 DEVKIT V1, partition scheme that includes LittleFS.
Secrets go in `SECRETS.h` (gitignored). `CLOUD_USE_TLS` is 0 (plain HTTP) to keep the build light.
