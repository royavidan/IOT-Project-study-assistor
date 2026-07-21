# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# MindBox firmware (ESP32-S3 board variant) — map

A **full port of the MindBox firmware** onto the **LCDWIKI ES3C28P/ES3N28P 2.8" ESP32-S3 board**
(ILI9341 240×320 SPI TFT driven by **LovyanGFX**, plus an **FT6336 capacitive touch** and a **VL53L1X
ToF** that share one Arduino-`Wire` I2C bus). It boots to a touch-navigable **home menu** and
runs the complete session lifecycle (the same brain as the classic-ESP32 sibling in
`../../MindBox - hardware/MindBox/`). The S3 differs from the sibling only in the **display** (TFT,
not OLED) and **input** (touch ± encoder, not encoder-only); the rest of the firmware is the sibling's
code, copied in.

> **Status:** builds and runs on hardware; UI styling modeled on einoko/Tomato32. **Currently enabled
> (`config.h`):** TFT + FT6336 touch, `HAS_ENCODER` (KY-040, coexists with touch), `HAS_PRESENCE`
> (VL53L1X ToF — **back on**, sharing the touch I2C bus as a single master), `HAS_I2S_MIC` +
> `HAS_SPEAKER` (ES8311), `HAS_LIGHT` (KY-018), `HAS_TEMP` (DHT11), `ENABLE_WIFI` + `ENABLE_CLOUD`.
> **OFF:** `HAS_HAPTIC` (motor removed), `HAS_LED_RING`, `HAS_BATTERY`. Mic/speaker/ToF all raise boot
> current — if the box reboot-loops on a weak USB supply the fix is a stronger 5V source (see **Power /
> brownout** below), not turning them off. Wi-Fi/cloud need `src/SECRETS.h` + the dev server to do
> anything. The `HAS_*` flags in `config.h` are the SSOT for what is live — read them before assuming a
> peripheral is present.

## Repository layout
Flat sketch under `src/` (like the sibling — Arduino compiles `src/` recursively; every module uses
plain `#include "X.h"`). `MindBox.ino` is the orchestrator only. `docs/` and `assets/` aren't compiled.

| Group | Files |
|---|---|
| **Entry** | `MindBox.ino` (Wire, watchdog, init-all, tick loop + BOOT theme toggle) |
| **Config / types** | `src/config.h` (SSOT: pins, `USE_TOUCH`/`HAS_*` flags, tunables), `src/types.h`, `src/focus_load.h` |
| **Display (S3-specific)** | `src/Panel.*` (LovyanGFX device: `lcd`, `spr`, `Panel::canvas()/push()`), `src/Display.*` (the firmware's `Display::` API on the TFT: `render`/`renderMenu`/primitives), `src/TimerScreen.*` (RUNNING screen, Tomato32 styling), `src/Theme.*`, `src/Icons.h`, `src/Fonts.h` + `src/DotFont.h` (bundled glyphs) |
| **Input (S3-specific)** | `src/Inputs.*` (encoder + side-button + touch → `rotationDir()/button()`), `src/Touch.*` (custom FT6336 driver over Arduino `Wire`; learned 4-corner NVS calibration), `src/Keyboard.*` (on-screen QWERTY for Wi-Fi entry) |
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
The menu expects `rotationDir()` (signed detents) + `button()` (1=select, 2=back). **Three** sources feed
them; `Inputs::poll` reads them in priority order **encoder → side button → touch**:
- **Encoder (`HAS_ENCODER`, ON):** KY-040 — **CLK=IO2, DT=IO14** (two of the only four broken-out GPIO).
  Rotation moves the menu cursor (signed delta, so fast multi-step turns aren't dropped). The shaft press
  is **not** read through the encoder lib (`PIN_ENC_SW=-1`; its `isEncoderButtonClicked()` busy-waits
  ~330 ms and stalled the loop) — `knobClicked()` is therefore inert; the shaft button is wired to IO21
  and read as the side button below. Power from **3V3, not 5V**. Needs the **AiEsp32RotaryEncoder** library.
- **Side button (`PIN_BUTTON=IO21`, `pollSideButton`):** the encoder's shaft button as a plain debounced
  tact (active-low; **shares IO21 with the DHT11**, whose pull-up holds it high at rest). **Short tap =
  select (1), long hold ≥ `BTN_LONG_MS` = back (2).** A pin found stuck LOW at boot is treated as
  miswired and ignored (`sideFault()`).
- **Touch (`USE_TOUCH`, default):** FT6336 capacitive read over Arduino `Wire` in `Touch.cpp`. Touch is a
  **plain click, not a position picker** — *where* you tap doesn't matter (the old `rowHitTest` approach
  was removed because an off calibration kept landing on the wrong row). **Short tap = select the
  highlighted row, long-press = back, vertical swipe = move the highlight** (like an encoder detent). On
  the bare RUNNING/PAUSED timer screen, *any* touch opens the session menu. `Touch.cpp` keeps a learned
  **4-corner calibration** in NVS (a raw→screen linear map that learns swap/mirror, so it's correct for
  any rotation) applied on boot; **long-press BOOT** re-runs it. (`TOUCH_OFFSET_ROTATION` is vestigial —
  calibration learns orientation; `rowHitTest`/`selectedRow` still exist in `Display` but no longer drive
  navigation.)
- **BOOT (GPIO0):** short tap = dark/light theme; long hold (>1.5 s) = recalibrate touch.

`Keyboard.*` is a separate touch surface (not part of `rotationDir()/button()`): an on-screen QWERTY
fed absolute tap coords via Inputs' raw-tap mode, used to type a Wi-Fi SSID/password on the TFT.

## Board pin map (LCDWIKI ES3C28P/ES3N28P datasheet — verified against `config.h`)
The **wired/onboard pins are confirmed correct** in `config.h` (datasheet CR2025-MI6890):
- **LCD (SPI2):** CS=10, DC=46, SCK=12, MOSI=11, MISO=13, BL=45; RST tied to chip EN (`PIN_TFT_RST -1`).
- **I2C bus (SDA=16, SCL=15):** **one Arduino-`Wire` master, two devices** — FT6336 touch (0x38, in
  `Touch.cpp`) and VL53L1X ToF (0x29, in `Sensors.cpp`). They serialize on the bus from the core-1 loop;
  there is no second master (the old two-master pad-swap is what killed touch). `TOUCH_I2C_PORT` is a
  dead define — touch runs on `Wire` (port 0), not its own port. Touch INT=17, RST=18 (RST pulsed in
  `Panel::begin`). ToF has no XSHUT/GPIO1 wired.
- **Audio (ES8311 I2S):** MCLK=4, BCLK=5, **DOUT=8** (→speaker DAC), LRCK=7, **DIN=6** (←mic ADC),
  AMP_EN=1 (active-low); codec control is I2C 0x18 on the **touch** SDA/SCL, boot-only. (DOUT/DIN were
  swapped early on — IO8=DOUT, IO6=DIN is the corrected/working mapping.)
- **Encoder (KY-040, `HAS_ENCODER=1`):** CLK=IO2, DT=IO14 (GPIO header). `PIN_ENC_SW=-1` (lib SW off);
  the shaft button is on **IO21** (`PIN_BUTTON`, shared with the DHT11) and read by `pollSideButton`.
- **Other onboard:** BOOT=0, UART0 TX=43/RX=44, USB=19/20, **RGB LED=42** (single-wire WS2812-style),
  **battery ADC=9**, SD card=38/40/39/41/48/47 (firmware uses internal-flash LittleFS, not the SD slot).

The firmware does **not** currently drive the onboard RGB LED (IO42) or read battery (IO9): `LedRing`
targets an external WS2812B ring and battery is stubbed. **The board breaks out only 4 GPIO** (GPIO
header: IO2, IO3, IO14, IO21 — docs/WIRING.md §1): IO2/IO14 = encoder CLK/DT, IO3 = light, **IO21 is
double-booked** — DHT11 data *and* the encoder shaft button (`PIN_BUTTON`), which coexist because the
DHT's pull-up holds the active-low button line high at rest. There is no fifth header pin. The other
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

**Required libraries** (Library Manager): **LovyanGFX**, **AiEsp32RotaryEncoder** (`HAS_ENCODER=1`),
**Adafruit VL53L1X** (`HAS_PRESENCE=1` — ToF is back on), **DHT sensor library** + **Adafruit Unified
Sensor**; **Adafruit NeoPixel** only if you re-enable the LED ring (off). FT6336 touch needs **no extra
library** — it's read directly over Arduino `Wire` in `Touch.cpp` (LovyanGFX's own touch driver was
removed from `Panel.cpp`). `CLOUD_USE_TLS` stays 0 (plain HTTP) to keep the build light.

Font note: hero numerals use bundled `FreeSans` as a stand-in for Tomato32's thin Inter — a real Inter
VLW drops into `assets/` and is a one-line `setFont` swap in `TimerScreen`.

## Threading + device↔server contract (from the sibling)
The Arduino `loop()` runs input → FSM → render on core 1; `Cloud::begin()` spawns the Wi-Fi/HTTP/
telemetry/upload **net task on core 0**. They share state only through thread-safe shims + `Storage`'s
recursive NVS mutex; the loop watchdog reboots on a stall. The box calls the web app's ingest API
(`POST /ingest/sessions|telemetry|pairing|unpair|homework`, `GET /ingest/config`) with
`x-device-secret`; `SECRETS.h` must match the app's `.env`.

### Site↔device features (2026-07 downlink growth)
- **Downlink** (`GET /ingest/config`, parsed in `Cloud::syncDownlink`) gained: `themeId` (accent
  preset 0-4 → `Theme::setAccentPreset`, C_* colours are now macros over the active `AccentSet`),
  `focusMin/breakMin/timingRev` (adopt-once-per-rev pomodoro timing; `Storage::lastTimingRev`) plus
  `longBreakMin/cycles` (adopted in the SAME once-per-rev block → `s_cycleCount`/`Storage::setCycleCount`
  + `s_cfg.longBreak*` via `saveConfig`, `longBreakEvery = cycleCount` = long break after the last block),
  `examMode` (DND) + `nextExamDays/Title` (root "EXAM Nd" badge via `Menu::setExamInfo`),
  `streakDays/weekFocusMin` (STATS rows via `Menu::setCloudStats`), `hwStr` (top-3 homework →
  `parseHwStr`), `weekStr` (rest-of-week schedule, days 1..6 ahead, ≤36 items → `parseWeekStr`;
  browsed by the **ST_AGENDA day pager** — swipe/rotate pages Today→+6d, day 0 still renders
  `agenda[]` and auto-start reads `agenda[]` only), and the command channel
  `cmdId/cmdType/cmdArg/cmdText`. **`HTTP_MAX_BODY` is 8192** to fit the grown payload (over-cap
  bodies are dropped silently). `CloudSettings` is ~2.9 KB now — both its copies are `static`
  (net task + loop), never task-stack locals.
- **Remote commands**: the once-dead `s_cmdQueue`/`Cloud::nextCommand` path is live. `syncDownlink`
  enqueues a NEW `cmdId` (dedupe: the server re-serves an un-acked command after 75s), acks via
  `&ack=<id>` on the next config GET, and sets `s_configNow` so bursts drain ~1/s.
  `StateMachine::handleRemoteCmd` maps `CmdType` (wire values 1=start 4=end 5=ring 6=message —
  keep in sync with the web `command-encode.ts`): start/end reuse the menu paths, ring =
  `Sound::ring()` (find-my, MAX volume, bypasses every gate), message = alert chime + **`ST_MESSAGE`**
  splash (`Display::renderMessage`; held in a 1-slot buffer if a session is running).
  **`CMD_START` with `cmdArg == 0`** (preserved as `durationMin 0` in `Cloud`, not clamped up) runs the
  FULL configured session (`startSession()` — set + breaks + long break); `cmdArg > 0` is a one-off block.
- **Agenda TZ safety net**: `ownerLocalNow`/`agendaDayLabel` fall back to the box's TZ-correct local
  offset (`localtime_r`'s `tm_gmtoff`, same as the header clock) when `s_tzOffsetMin == 0`, so a
  missing/zero server offset no longer renders the Today/agenda clock as UTC.
- **`ST_HOMEWORK`** (`Display::renderHomework`): offered from ST_COMPLETE's go-idle path after a
  finished WORK interval (paired + `hwCount > 0`); tap = +25%, hold = done, Skip row/20s = exit;
  progress taps queue through `Cloud::postHomework` → `POST /ingest/homework`.
- **Exam DND**: `Sound::setDnd(true)` mutes every chime except ring; coaching + interference nudges
  are suppressed in StateMachine while `examMode` (quiet-hours screen-dim untouched).
- **Telemetry uplink** gained optional `tempC/humidityPct/lightLux/noiseDb` — filled LOOP-side into
  `TelemetrySnap` (sentinels NAN/-1) only when the sensor is wired + valid; humidity comes from the
  DHT11 via the new `Sensors::readHumidity`.

## Audio subsystem (S3-only; mic + speaker now ON)
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
association current spike** sags the rail. The one mitigation left in the tree is `WIFI_TX_POWER` capped
to 8.5 dBm (and `WIFI_MODEM_SLEEP=0` to keep the link solid). Mic/speaker/ToF are now **on**, so boot
current is back up — a marginal supply will reboot-loop; the cure is a stronger 5V source, not flipping
those `HAS_*` flags back off. `DISABLE_BROWNOUT_DETECTOR` is intentionally
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
