# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
Arduino IDE with the ESP32 core; board = **DOIT ESP32 DEVKIT V1**, a partition scheme that includes
LittleFS/SPIFFS (Tools → Partition Scheme), Serial @ **115200**. There is no CLI build config — it's an
Arduino sketch compiled from the GUI. `CLOUD_USE_TLS` is 0 (plain HTTP) to keep the build light;
flipping it pulls in `WiFiClientSecure`/mbedtls and can exhaust the host toolchain's memory.

**Required libraries** (Library Manager): Adafruit GFX, Adafruit SH110X, Adafruit SSD1306,
Adafruit VL53L1X, Adafruit NeoPixel, DHT sensor library + Adafruit Unified Sensor, AiEsp32RotaryEncoder.

**Feature flags live in `config.h`** (`HAS_*`, `ENABLE_WIFI`, `ENABLE_CLOUD`, `USE_SPDT_TOGGLE`); flip
0→1 as hardware is wired. `config.h` is the single source of truth for pins, tunables, and `FW_VERSION` —
nothing else hard-codes a pin or threshold.

## Secrets & first-boot provisioning
`SECRETS.h` (gitignored) holds Wi-Fi creds, the app base URL, and `SECRET_DEVICE_SECRET` — which must
**exactly match** `DEVICE_INGEST_SECRET` in the web app's `.env`, or ingest 401s. These are only
*first-boot defaults*: once set over serial they persist in NVS and override `SECRETS.h`. The base URL is
the dev server's LAN address (the `Network:` line from `npm run dev -- --host` in the web app).

## Serial commands (@115200)
| Key | Action |
|---|---|
| `w` | Provision Wi-Fi / base URL / device secret into NVS at runtime (no reflash) |
| `c` | Print sensor calibration + live readings; `c noise 1800` / `c light 1200` / `c lightvar 2000` / `c temp -1.5` to set, `c reset` to restore (see `ARCHITECTURE.md`) |
| `m` | 1 Hz live monitor (state, timer, presence, noise, ToF, Wi-Fi, buffered count) |
| `d` | One-shot diagnostic dump · `h` help |

Boot prints a self-test (I2C scan, OLED, ToF, mic, Wi-Fi). On the box, Device → Diagnostics mirrors it.
