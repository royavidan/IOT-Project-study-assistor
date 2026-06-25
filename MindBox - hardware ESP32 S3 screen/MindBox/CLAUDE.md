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

> **Status:** builds and runs on hardware; UI styling modeled on einoko/Tomato32. **Currently enabled
> (`config.h`):** TFT + FT6336 touch, `HAS_ENCODER` (KY-040, coexists with touch), `HAS_I2S_MIC` +
> `HAS_SPEAKER` (ES8311), `HAS_LIGHT` (KY-018), `HAS_TEMP` (DHT11), `ENABLE_WIFI` + `ENABLE_CLOUD`.
> **OFF:** `HAS_PRESENCE` (ToF — removed; its IO2/IO14 now feed the encoder), `HAS_HAPTIC` (motor
> removed), `HAS_LED_RING`, `HAS_BATTERY`. Re-enable mic/
> speaker only on a solid 5V supply (see **Power / brownout** below). Wi-Fi/cloud need `src/SECRETS.h` +
> the dev server to do anything. The `HAS_*` flags in `config.h` are the SSOT for what is live — read
> them before assuming a peripheral is present.

## Repository layout
Flat sketch under `src/` (like the sibling — Arduino compiles `src/` recursively; every module uses
plain `#include "X.h"`). `MindBox.ino` is the orchestrator only. `docs/` and `assets/` aren't compiled.

| Group | Files |
|---|---|
| **Entry** | `MindBox.ino` (Wire, watchdog, init-all, tick loop + BOOT theme toggle) |
| **Config / types** | `src/config.h` (SSOT: pins, `USE_TOUCH`/`HAS_*` flags, tunables), `src/types.h`, `src/focus_load.h` |
| **Display (S3-specific)** | `src/Panel.*` (LovyanGFX device: `lcd`, `spr`, `Panel::canvas()/push()`), `src/Display.*` (the firmware's `Display::` API on the TFT: `render`/`renderMenu`/primitives), `src/TimerScreen.*` (RUNNING screen, Tomato32 styling), `src/Theme.*`, `src/Icons.h`, `src/Fonts.h` + `src/DotFont.h` (bundled glyphs) |
| **Input (S3-specific)** | `src/Inputs.*` (touch → `rotationDir()/button()`, encoder under `HAS_ENCODER`), `src/Touch.*` (FT6336 capacitive, I2C), `src/Keyboard.*` (on-screen QWERTY for Wi-Fi entry) |
| **Brain** | `src/StateMachine.*`, `src/Session.*`, `src/Menu.*` |
| **Persistence** | `src/Storage.*` (NVS), `src/UploadQueue.*` (LittleFS) |
| **Networking** | `src/Cloud.*`, `src/Payload.*`, `src/SECRETS.h` (gitignored creds) |
| **Sensing / output** | `src/Sensors.*`, `src/Haptics.*`, `src/LedRing.*`, `src/Audio.*` (ES8311 I2S mic+speaker), `src/Sound.*` (lifecycle chimes) |
| **Diagnostics** | `src/Diagnostics.*` |
| **Docs** | `docs/HARDWARE.md` (port guide), `docs/WIRING.md` + `WIRING.pdf` (per-part wiring, cited from `config.h`), `docs/SIBLING-REFERENCE.md` (non-authoritative snapshot) |

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
- **Encoder (`HAS_ENCODER`, ON):** KY-040 on the ex-ToF pins — **CLK=IO2, DT=IO14** (the GPIO header's
  only free pins). Rotation moves the menu cursor; **select/back is via touch** — the board breaks out no
  4th header pin for a shaft button, so **SW=-1**. (The shaft press, `knobClicked()`, is only a
  dead-end-screen escape anyway, not the primary select.) Coexists with touch (`Inputs::poll` reads the
  encoder first, then touch). Power from **3V3, not 5V**. Requires the **AiEsp32RotaryEncoder** library.
- **BOOT (GPIO0):** short tap = dark/light theme; long hold = recalibrate touch.

`Keyboard.*` is a separate touch surface (not part of `rotationDir()/button()`): an on-screen QWERTY
fed absolute tap coords via Inputs' raw-tap mode, used to type a Wi-Fi SSID/password on the TFT.

## Board pin map (LCDWIKI ES3C28P/ES3N28P datasheet — verified against `config.h`)
The **wired/onboard pins are confirmed correct** in `config.h` (datasheet CR2025-MI6890):
- **LCD (SPI2):** CS=10, DC=46, SCK=12, MOSI=11, MISO=13, BL=45; RST tied to chip EN (`PIN_TFT_RST -1`).
- **Touch (FT6336, I2C):** SDA=16, SCL=15, INT=17, RST=18.
- **Audio (ES8311 I2S):** MCLK=4, BCLK=5, **DOUT=8** (→speaker DAC), LRCK=7, **DIN=6** (←mic ADC),
  AMP_EN=1 (active-low); codec control is I2C 0x18 on the **touch** SDA/SCL. (DOUT/DIN were swapped
  early on — IO8=DOUT, IO6=DIN is the corrected/working mapping.)
- **Encoder (KY-040, `HAS_ENCODER=1`):** CLK=IO2, DT=IO14 (ex-ToF I2C pins, GPIO header). SW disabled
  (-1) — no free header pin; select via touch.
- **Other onboard:** BOOT=0, UART0 TX=43/RX=44, USB=19/20, **RGB LED=42** (single-wire WS2812-style),
  **battery ADC=9**, SD card=38/40/39/41/48/47 (firmware uses internal-flash LittleFS, not the SD slot).

The firmware does **not** currently drive the onboard RGB LED (IO42) or read battery (IO9): `LedRing`
targets an external WS2812B ring and battery is stubbed. **The board breaks out only 4 GPIO** (GPIO
header: IO2, IO3, IO14, IO21 — docs/WIRING.md §1): IO2/IO14 = encoder CLK/DT, IO3 = light, IO21 = temp.
That leaves **no free header pin** for an encoder shaft button (SW=-1; select via touch). The other
external-peripheral pins in `config.h` are **inert placeholders (`HAS_*`=0)** that map to pins NOT on any
header — `PIN_HAPTIC 48` (unused, motor removed), `PIN_LED_RING 39`=SD_D0, `PIN_BATTERY_ADC 6`=I2S_DIN;
real battery is IO9. **`docs/WIRING.md` is the S3-accurate wiring reference; `docs/HARDWARE.md` §2's
inventory still lists the OLED sibling's pins — don't trust it for the S3.**

## Build / flash
Arduino IDE + ESP32 core. **Board settings (from the LCDWIKI datasheet):** Board = **ESP32S3 Dev
Module** · **USB CDC On Boot = Enabled** · Flash Size = **16MB** · Partition Scheme = **"Huge APP
(3MB No OTA/1MB SPIFFS)"** · **PSRAM = "OPI PSRAM"** · Serial **115200**. (OPI PSRAM matters — the
default QSPI setting makes `psramFound()` fail and the full-screen sprite fall back to flickery direct
draw. The SPIFFS partition is where LittleFS mounts the upload queue.)

**Required libraries** (Library Manager): **LovyanGFX**, **AiEsp32RotaryEncoder** (now required —
`HAS_ENCODER=1`), **DHT sensor library** + **Adafruit Unified Sensor**, **Adafruit NeoPixel** (LED ring,
off), **Adafruit VL53L1X** (ToF, off/removed). FT6336 touch uses LovyanGFX's built-in `Touch_FT5x06` — no extra library.
`CLOUD_USE_TLS` stays 0 (plain HTTP) to keep the build light.

Font note: hero numerals use bundled `FreeSans` as a stand-in for Tomato32's thin Inter — a real Inter
VLW drops into `assets/` and is a one-line `setFont` swap in `TimerScreen`.

## Threading + device↔server contract (from the sibling)
The Arduino `loop()` runs input → FSM → render on core 1; `Cloud::begin()` spawns the Wi-Fi/HTTP/
telemetry/upload **net task on core 0**. They share state only through thread-safe shims + `Storage`'s
recursive NVS mutex; the loop watchdog reboots on a stall. The box calls the web app's ingest API
(`POST /ingest/sessions|telemetry|pairing|unpair`, `GET /ingest/config`) with `x-device-secret`;
`SECRETS.h` must match the app's `.env`.

## Audio subsystem (S3-only, off by default)
The board carries an **ES8311 codec + FM8002E amp on I2S** — the only mic and speaker.
- **`Audio.*`** is the driver. `Audio::begin()` configures the ES8311 once at boot over **software-I2C
  on the touch pins (IO16/IO15, addr 0x18)** — this must run **before `Display::init()`** claims that
  bus, which is why `MindBox.ino` calls it early. At runtime audio is **I2S-only** (no codec I2C), so
  there's no contention with the FT6336 touch controller. A core-0 task reads I2S mic frames and
  publishes a rolling ~1 Hz RMS as `micLevel()`; `Sensors::noise()` consumes it (so the mic feeds the
  existing noise/interference/telemetry pipeline). Volume is software sample-scaling, never codec writes.
- **`Sound.*`** is the lifecycle layer: `start/pause/resume/complete/test` enqueue chimes via
  `Audio::playChime()`, mirroring `Haptics`, gated by `DeviceConfig.soundEnabled`/quiet hours.
- Both are inert while `HAS_I2S_MIC`/`HAS_SPEAKER = 0`. Serial `a` prints mic bring-up diagnostics
  (codec boot-ACK + raw I2S min/max/RMS) — use it when re-enabling the mic.

## Power / brownout (recurring failure mode)
This board browns out / reboot-loops on a marginal 5V supply (laptop USB) because the **Wi-Fi
association current spike** sags the rail. Mitigations already in the tree: `WIFI_TX_POWER` capped to
8.5 dBm, and mic/ToF/speaker left OFF to cut boot current. `DISABLE_BROWNOUT_DETECTOR` is intentionally
**0** — the IDF arms the detector before `setup()` runs, so the app-level mask can't stop a boot-stage
brownout and only turns a clean reboot into a dead-dark hang. **The real fix is a stronger 5V source**,
not a config flag. On-screen boot breadcrumbs (`bootMsg`) + the printed reset reason exist to tell a
power sag from a code panic without a serial cable.

## Serial commands (@115200)
`m` toggle 1 Hz monitor · `c` sensor calibration · `a` mic/audio probe · `b` button live test ·
`w` provision Wi-Fi/URL/secret · `q` upload-queue status · `d` dump · `h` help (from
`Diagnostics`/`Cloud`). Boot prints a self-test (firmware/reset/heap/PSRAM/I2C scan).

## See also
- [`docs/WIRING.md`](docs/WIRING.md) — **S3-accurate** per-part wiring (onboard RGB LED IO42, light IO3,
  haptic, etc.); the right reference when wiring a peripheral on this board.
- [`docs/HARDWARE.md`](docs/HARDWARE.md) — S3 port checklist (§6) + SoC-dependency notes. **Caveat:** its
  §2 component inventory still carries the **OLED sibling's** pins (encoder 18/19/23, button 4, mic 34,
  light 35, haptic 25, battery 36) — not the S3's; use the datasheet/`config.h`/`WIRING.md` for pins.
- `../../MindBox - hardware/MindBox/` — the source firmware (`ARCHITECTURE.md`, `Menu.cpp`,
  `StateMachine.cpp`); authoritative for any ported module's behavior.
