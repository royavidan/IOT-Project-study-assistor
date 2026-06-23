# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# MindBox firmware (ESP32-S3 board variant) — map

A **full port of the MindBox firmware** onto the **LCDWIKI ES3C28P/ES3N28P 2.8" ESP32-S3 board**
(ILI9341 240×320 SPI TFT + **FT6336 capacitive touch on I2C**, driven by **LovyanGFX**). It boots to a
touch-navigable **home menu** and
runs the complete session lifecycle (the same brain as the classic-ESP32 sibling in
`../../MindBox - hardware/MindBox/`). The S3 differs from the sibling only in the **display** (TFT,
not OLED) and **input** (touch ± encoder, not encoder-only); the rest of the firmware is the sibling's
code, copied in.

> **Status:** ported and structurally complete, but **not yet compiler-verified on hardware**. The UI
> styling is modeled on einoko/Tomato32. Peripherals (sensors, haptics, LED ring, encoder, battery)
> are present **behind their `HAS_*` flags = off** until wired; Wi-Fi/cloud need `src/SECRETS.h` + the
> dev server to do anything.

## Repository layout
Flat sketch under `src/` (like the sibling — Arduino compiles `src/` recursively; every module uses
plain `#include "X.h"`). `MindBox.ino` is the orchestrator only. `docs/` and `assets/` aren't compiled.

| Group | Files |
|---|---|
| **Entry** | `MindBox.ino` (Wire, watchdog, init-all, tick loop + BOOT theme toggle) |
| **Config / types** | `src/config.h` (SSOT: pins, `USE_TOUCH`/`HAS_*` flags, tunables), `src/types.h`, `src/focus_load.h` |
| **Display (S3-specific)** | `src/Panel.*` (LovyanGFX device: `lcd`, `spr`, `Panel::canvas()/push()`), `src/Display.*` (the firmware's `Display::` API on the TFT: `render`/`renderMenu`/primitives), `src/TimerScreen.*` (RUNNING screen, Tomato32 styling), `src/Theme.*`, `src/Icons.h` |
| **Input (S3-specific)** | `src/Inputs.*` (touch → `rotationDir()/button()`, encoder under `HAS_ENCODER`), `src/Touch.*` (FT6336 capacitive, I2C) |
| **Brain** | `src/StateMachine.*`, `src/Session.*`, `src/Menu.*` |
| **Persistence** | `src/Storage.*` (NVS), `src/UploadQueue.*` (LittleFS) |
| **Networking** | `src/Cloud.*`, `src/Payload.*`, `src/SECRETS.h` (gitignored creds) |
| **Sensing / output** | `src/Sensors.*`, `src/Haptics.*`, `src/LedRing.*` |
| **Diagnostics** | `src/Diagnostics.*` |
| **Docs** | `docs/HARDWARE.md` (port guide), `docs/SIBLING-REFERENCE.md` (non-authoritative snapshot) |

`StateMachine::tick()` reads `Inputs` → runs the FSM (`Menu`/`Session`) → draws via `Display`. `Display`
is driven only by a `UiModel`/`MenuView` value, so the brain is display-agnostic (that's why the
sibling's logic ports unchanged onto the TFT).

## Input model (the S3 adaptation)
The menu expects `rotationDir()` (−1/0/+1) + `button()` (1=select, 2=back), produced by:
- **Touch (`USE_TOUCH`, default):** **FT6336 capacitive on I2C** (`SDA=16, SCL=15, INT=17, RST=18,
  addr 0x38`, config in `config.h`). `Inputs` does **direct row-tap** (walks the menu cursor onto the
  tapped row via `Display::rowHitTest`/`selectedRow`, then selects); top-right corner = back; zones are
  the fallback where there are no rows. `Touch.cpp` keeps a persistent corner calibration (NVS) applied
  on boot; **long-press BOOT** recalibrates. If axes are mirrored/rotated, bump `TOUCH_OFFSET_ROTATION`.
- **Encoder (`HAS_ENCODER`, off):** KY-040 path, pins in `config.h`; needs the AiEsp32RotaryEncoder
  library only when enabled.
- **BOOT (GPIO0):** short tap = dark/light theme; long hold = recalibrate touch.

## Build / flash
Arduino IDE + ESP32 core. **Board settings (from the LCDWIKI datasheet):** Board = **ESP32S3 Dev
Module** · **USB CDC On Boot = Enabled** · Flash Size = **16MB** · Partition Scheme = **"Huge APP
(3MB No OTA/1MB SPIFFS)"** · **PSRAM = "OPI PSRAM"** · Serial **115200**. (OPI PSRAM matters — the
default QSPI setting makes `psramFound()` fail and the full-screen sprite fall back to flickery direct
draw. The SPIFFS partition is where LittleFS mounts the upload queue.)

**Required libraries** (Library Manager): **LovyanGFX**, **Adafruit VL53L1X**, **Adafruit NeoPixel**,
**DHT sensor library** + **Adafruit Unified Sensor**, **AiEsp32RotaryEncoder** (only if
`HAS_ENCODER=1`). FT6336 touch uses LovyanGFX's built-in `Touch_FT5x06` — no extra library.
`CLOUD_USE_TLS` stays 0 (plain HTTP) to keep the build light.

Font note: hero numerals use bundled `FreeSans` as a stand-in for Tomato32's thin Inter — a real Inter
VLW drops into `assets/` and is a one-line `setFont` swap in `TimerScreen`.

## Threading + device↔server contract (from the sibling)
The Arduino `loop()` runs input → FSM → render on core 1; `Cloud::begin()` spawns the Wi-Fi/HTTP/
telemetry/upload **net task on core 0**. They share state only through thread-safe shims + `Storage`'s
recursive NVS mutex; the loop watchdog reboots on a stall. The box calls the web app's ingest API
(`POST /ingest/sessions|telemetry|pairing|unpair`, `GET /ingest/config`) with `x-device-secret`;
`SECRETS.h` must match the app's `.env`.

## Serial commands (@115200)
`w` provision Wi-Fi/URL/secret · `c` sensor calibration · `m` 1 Hz monitor · `d` dump · `h` help
(from `Diagnostics`/`Cloud`). Boot prints a self-test.

## See also
- [`docs/HARDWARE.md`](docs/HARDWARE.md) — peripheral inventory, wiring traps, S3 port checklist (§6).
- `../../MindBox - hardware/MindBox/` — the source firmware (`ARCHITECTURE.md`, `Menu.cpp`,
  `StateMachine.cpp`); authoritative for any ported module's behavior.
