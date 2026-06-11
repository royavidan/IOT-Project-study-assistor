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
| `Sensors` | mic, ToF; temp/light/battery (**stubs**) | config | 8, 9, 10, 17, 18 |
| `Storage` | NVS: device id, last duration, config, session buffer | types | 4, 7 |
| `Cloud` | Wi-Fi + ingest upload + **config downlink** (**stub**) | types | 4, 5, 8, 11, 12 |
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
                    └─ Storage ─ Cloud
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

## Status of parts (2026-06-11)

Active & validated: encoder, button, OLED, mic, motor, ToF.
Stubbed behind flags: LED ring, light, temp, battery, Wi-Fi, cloud.
The single biggest app-side dependency to make the **site→box config** real
(your `showTimer` toggle) is the new `GET /ingest/config` endpoint — see
`Cloud.cpp::fetchConfig()`.
