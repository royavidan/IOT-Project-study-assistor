# MindBox firmware — architecture & maintenance guide

The firmware is split into **single-responsibility modules** (one `.h` interface +
one `.cpp` implementation each). The `.ino` only wires them together. This keeps
each part small enough for one person to own, test, and replace.

## Module map

| Module | Owns | Talks to | User stories |
|---|---|---|---|
| `config.h` | pins, feature flags, tunables, FW version | (everything includes it) | — |
| `types.h` | enums, structs, `UiModel`, `modeName`, `defaultConfig` | — | — |
| `focus_load.h` | FLE heuristic (mirror of app's `focus-load.ts`) | Session | 10 |
| `Display` | OLED auto-detect (SH1106/SSD1306) + all screens | types | 2, 3, 15 |
| `LedRing` | WS2812B status ring (**stub**, `HAS_LED_RING`) | types | 2, 15, 16 |
| `Haptics` | non-blocking vibration patterns | config | 2, 9, 16 |
| `Inputs` | encoder, side button, SPDT | config | 1, 3, 7 |
| `Sensors` | mic, ToF, DHT11, KY-018; battery (**stub**) | config | 8, 9, 10, 17, 18 |
| `Storage` | NVS: device id, last duration, config, session buffer | types | 4, 7 |
| `UploadQueue` | LittleFS offline session backlog (Part B) | Payload, Storage | 4 |
| `Cloud` | Wi-Fi + ingest upload + config downlink | UploadQueue, types | 4, 5, 8, 11, 12 |
| `Payload` | device→cloud JSON serializer (`SessionPayload`) | types | 5, 8, 10 |
| `Session` | countdown, sampling, FLE, `SessionRecord` | Sensors, focus_load | 5, 8, 10 |
| `StateMachine` | session lifecycle + orchestration | all of the above | 1, 9, 16 |
| `Menu` | pointer menus (rotate=cursor, click=select) | Inputs, Display, Storage | 1, 3 |
| `Diagnostics` | serial self-test + live monitor | Sensors, Session, StateMachine, Cloud | 15 |
| `MindBox.ino` | `setup()` wiring + `loop()` ticks | all modules | — |

## Dependency direction (no cycles)

```
MindBox.ino
   └─ StateMachine ─┬─ Menu ─ Inputs
                    ├─ Sensors ─ Session ─ focus_load
                    ├─ Display ─ LedRing ─ Haptics
                    └─ Storage ─ Cloud ─ UploadQueue
   └─ Diagnostics ──> (reads StateMachine / Session / Sensors / Cloud)
```

`Display` is driven only through a `UiModel` value, so it never depends on the
state machine. `Diagnostics` only *reads* other modules.

## How to extend (the common tasks)

- **Add a sensor (e.g. light/temp):** fill its `read*()` in `Sensors.cpp`, set
  `HAS_LIGHT`/`HAS_TEMP` = 1 in `config.h`. Session already records it.
- **Wire the LED ring:** set `HAS_LED_RING` = 1 + `PIN_LED_RING`; flesh out
  `LedRing::show()` colors. Everything already calls it.
- **Go online:** set `ENABLE_WIFI`/`ENABLE_CLOUD` = 1, implement the `Cloud.cpp`
  TODOs (captive portal, NTP, the four HTTP calls). Payload shapes: copy
  `mindbox-companion-forge-main/scripts/simulator.ts`.
- **Change a menu or session screen:** edit `Menu.cpp` and/or `Display.cpp`.
- **Re-map a control / add a menu item:** edit `Menu.cpp` (+ `StateMachine.cpp` if it starts a session).

## Sensor calibration (NVS, no reflash)

Mic noise, light lux/variance, and DHT temperature offset are stored in NVS (`Storage`)
and applied in `Sensors.cpp`. Defaults live in `config.h` (`*_DEFAULT` constants).

**Serial @115200** — press `c` to print current values; type a line after `c` to set:

| Command | Effect |
|---------|--------|
| `c` | Print scales + live readings |
| `c noise 1800` | Mic ADC peak-to-peak that maps to 1.0 normalized |
| `c light 1200` | KY-018 ADC → “lux” estimate scale |
| `c lightvar 2000` | Light flicker → FLE variance scale |
| `c temp -1.5` | Add °C offset to DHT11 (bias correction) |
| `c reset` | Restore all defaults |

**Field procedure (at your desk):**

1. **Noise:** `m` monitor in a quiet room — aim `noise` ~0.05–0.15. Clap or tap desk — aim
   ~0.8+. If too sensitive, *raise* `c noise <value>`; if too dull, *lower* it.
2. **Light:** Desk lamp on/off — aim “lux” roughly 200–800 under normal desk lighting
   (labels are estimates, not true lux). Adjust `c light <value>`.
3. **Light variance:** If FLE barely reacts to light changes, *lower* `c lightvar`; if too
   jumpy, *raise* it.
4. **Temp:** Compare DHT reading to a room thermometer; set offset so they match
   (`c temp -2` if DHT reads 2°C high).

Values persist across reboot. `Sensors::reloadCalibration()` runs on boot and after each `c` save.

## Pointer menu (IDLE home — `Menu.cpp` + `Display::renderMenu`)

When idle, the OLED shows a scrollable list with a `>` cursor:

```
> Start
  Mode            WORK
  Duration        25 min
  Settings
  (Device, About — scroll)
```

| Input | Action |
|-------|--------|
| Rotate knob | Move cursor |
| Side button short | Select / enter / toggle / save |
| Side button long | Back one level (no-op on main menu root) |
| Knob shaft click | Unused |

During **RUNNING**: side short = pause, side long = abort (unchanged).

**Start** → Ready → **Begin** starts the session. **Mode**, **Duration**, **Settings**
(Display toggles), **Device** (Pair, Diagnostics), **About** are all menu entries.

## State diagram (session lifecycle — `StateMachine.cpp`)

```
BOOTING -> IDLE (menu root)
IDLE    -> RUNNING (menu: Start -> Begin)
        -> PAIRING / DIAG (menu: Device)
RUNNING -> PAUSED (side button / presence lost)
        -> COMPLETE (timer 0) | IDLE-abort (side long) | ERROR (fault)
PAUSED  -> RUNNING (menu: Resume / presence back) | end (menu or side long)
COMPLETE-> LOGGING -> IDLE (menu root)
PAIRING -> IDLE (side button)     DIAG -> IDLE (side button)
ERROR   -> IDLE (side long-press)
```

## Monitoring (the "watch the timer & sensors" option)

- **Serial @115200:** boot prints a self-test (I2C scan, OLED, ToF, mic, Wi-Fi).
  Press `m` for a 1 Hz live stream (state, timer, mode, presence, distance,
  noise, ToF, Wi-Fi, buffered count); `d` for a single dump; `h` for help.
- **On the box:** Device → Diagnostics in the pointer menu (OLED driver, ToF,
  mic level, Wi-Fi, firmware version). Side button exits.

## Sync model & sampling policy (offline-first; Parts A–C)

Save locally first, upload when Wi-Fi is available — never block a session on the network.

- **`slog` (NVS):** 16 compact entries for the on-OLED stats/history (the working set).
- **Upload queue (LittleFS, Part B):** the durable backlog — full `SessionRecord` +
  `Sample[]` per pending session. Cap ~12 sessions; drop-oldest on overflow with a diag flag.
  NVS is too small (~20 KB) to hold 40 KB+ of sample payloads, so the queue lives on the FS.
- **`Payload::sessionJson()`** is the single canonical upload shape — it matches
  `src/lib/focus-load.ts` (`SessionPayload`) and the Zod schema in
  `src/lib/ingest/ingest.server.ts`. Every completed session prints this JSON to serial
  today (Part A contract check); Part C POSTs it to `/ingest/sessions`.

Sampling policy (target intervals, wired in Part D):

| State | Interval |
|-------|----------|
| WORK, coaching off | 60 s |
| WORK, coaching on  | 30 s |
| BREAK              | 120 s or off |
| PAUSED            | off |

Session countdown runs on `esp_timer` (10 ms) so main-loop stalls do not skip time.
Checkpoints are written on pause/resume/start/end — not on a periodic timer.

Each checkpoint (NVS `ckpt` v3) stores the last **10** `Sample` records plus noise
aggregates (`noiseSum`, `noisePeak`, `noiseN`) so a cold boot after power loss can
resume with env telemetry and correct session averages. Older samples beyond the
tail are not recovered (minimal NVS footprint).

Env aggregates (`focusLoadAvg`, `noiseAvg`/`noisePeak`, `tempC`, `lightLux`) are averaged
from `Sample[]` in `Session::finish()` — not a one-off recompute.

## Status of parts (2026-06-11)

Active & validated: encoder, button, OLED, mic, motor, ToF, DHT11, KY-018, Wi-Fi, cloud ingest, upload queue.
Stubbed behind flags: LED ring, battery, BLE.

Arduino library required for DHT11: **DHT sensor library** (Adafruit) + **Adafruit Unified Sensor**.
