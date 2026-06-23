# MindBox firmware — hardware inventory & chip-porting guide

Everything physical the firmware touches, **how** it touches it, and exactly what changes when we move
to another ESP chip (S3 / C3 / C6 / …). The goal: port the firmware to new silicon without re-reading
every module to rediscover which pin does what.

> **`config.h` is the single source of truth for pins.** This doc does **not** restate pin numbers as
> fact to maintain — it explains *roles, constraints, and how each part is driven*, and cites the macro
> + owning module so you can jump to the authoritative value. If a pin here ever disagrees with
> `config.h`, `config.h` wins.

---

## 1. Target board today

| | |
|---|---|
| **SoC** | ESP32 (classic), dual-core Xtensa LX6 |
| **Board** | DOIT ESP32 DevKit V1 (`esp32doit-devkit-v1`) |
| **Toolchain** | Arduino IDE (GUI build — no CLI config), ESP32 Arduino core |
| **Serial** | 115200 baud, hardware UART0 over the USB-UART bridge |
| **Partition** | must include LittleFS/SPIFFS (Tools → Partition Scheme) for the upload queue |
| **FW version** | `FW_VERSION` in `config.h` |

The firmware is deliberately portable in structure: pins/flags/tunables live only in `config.h`, and
each peripheral is owned by one module. The non-portable parts are the SoC-specific dependencies in
§3 — read those before a port.

---

## 2. Component inventory

| Component | Part | Interface | Pin macro (`config.h`) | Library · Module | How it's driven |
|---|---|---|---|---|---|
| Rotary encoder | KY-040 | digital A/B + shaft switch, ISR-driven | `PIN_ENC_CLK 18`, `PIN_ENC_DT 19`, `PIN_ENC_SW 23` | AiEsp32RotaryEncoder · `Inputs.cpp` | `enc.begin()/setup(isr)`; the ISR `readEncoder_ISR()` is `IRAM_ATTR`. Boundaries swap between menu cursor and duration steps via `setInputMode()`. |
| Side button | 6×6×3.6 mm tact | digital, `INPUT_PULLUP`, active-low | `PIN_BUTTON 4` (`BTN_ACTIVE_LOW 1`) | `Inputs.cpp` | Manual debounce + short/long-press classifier (`BTN_DEBOUNCE_MS`/`BTN_LONG_MS`). Detects "stuck LOW at rest" (mis-wired tact) and disables itself with a serial warning. |
| Work/Break toggle (optional) | SPDT switch | digital, `INPUT_PULLUP` | `PIN_SPDT 32` (gated by `USE_SPDT_TOGGLE`) | `Inputs.cpp` | Off by default; when enabled, `LOW` = Work. |
| Display | SH1106 **or** SSD1306 128×64 OLED | I2C @ 400 kHz, addr 0x3C/0x3D | `PIN_I2C_SDA 21`, `PIN_I2C_SCL 22` | Adafruit GFX + SH110X + SSD1306 · `Display.cpp` | **Runtime auto-detect**: probes 0x3C then 0x3D, tries SH1106 then SSD1306, binds a `Adafruit_GFX*`. All screens render from a single `UiModel` value (`Display::render`) — no module below the renderer knows which panel is present. |
| Microphone | GY-MAX9814 (electret + AGC) | analog out, ADC1 | `PIN_MIC 34` | `Sensors.cpp` | `analogReadResolution(12)`; rolling ~1 Hz peak-to-peak, normalized by an NVS-calibrated full-scale. Dead-mic detection (rails with no variation → invalid). |
| Presence | VL53L1X time-of-flight | I2C, addr 0x29 (shares the OLED bus) | — (on `PIN_I2C_*`) | Adafruit_VL53L1X · `Sensors.cpp` | Long-range mode, 50 ms timing budget, polled every `TOF_POLL_MS`. Doubles as the **I2C bus canary**: if it stops ACKing, `i2cRecover()` bit-bangs the bus free. |
| Temp / humidity | DHT11 | 1-wire digital + external pull-up | `PIN_DHT11 26` | DHT sensor library (+ Adafruit Unified Sensor) · `Sensors.cpp` | Min `DHT_READ_INTERVAL_MS` between reads; warmup-gated; NVS temp offset applied; range-clamped. |
| Light | Keyes KY-018 photoresistor | analog out, ADC1 | `PIN_LIGHT_ADC 35` | `Sensors.cpp` | 1 Hz window → "lux" estimate + flicker variance, both NVS-calibrated. Feeds the focus-load estimate. |
| Haptic motor | ERM coin motor via NPN/MOSFET | digital drive (optional LEDC PWM) | `PIN_HAPTIC 25` | `Haptics.cpp` | Non-blocking step-pattern engine. `gpio_set_drive_capability(..., CAP_3)` for max base/gate drive. PWM path (`HAPTIC_USE_PWM`) uses LEDC. |
| LED ring *(stubbed)* | WS2812B ×16 | single-wire (NeoPixel/RMT) | `PIN_LED_RING 5` (gated by `HAS_LED_RING`) | Adafruit_NeoPixel · `LedRing.cpp` | API complete (`show()/status()`); compiled out until `HAS_LED_RING=1`. |
| Battery *(stubbed)* | LiPo via resistor divider | analog, ADC1 | `PIN_BATTERY_ADC 36` (gated by `HAS_BATTERY`) | `Sensors.cpp` | `batteryPct()` returns a placeholder until `HAS_BATTERY=1`. |

### Wiring traps already encoded in `config.h` (don't relearn the hard way)
- **`PIN_ENC_SW` must not be 21** — GPIO 21 is I2C SDA on this board.
- **Button must not be GPIO 34–39** — those are input-only with **no internal pull-up**, so
  `INPUT_PULLUP` won't hold the line; the tact button needs a pull-up-capable pin.
- **Motor must not be GPIO 2** — it shares the onboard LED and the motor drive stays weak.
- **DHT11 needs a 4.7k–10k pull-up** on its data line to 3V3.
- **All analog sensors live on ADC1** (mic 34, light 35, battery 36) — see §3.

---

## 3. Platform (SoC) dependencies — the parts that break on a port

These are not peripherals; they're ESP32-family assumptions baked into the code. Check each one against
the target chip.

- **ADC1-only for analog.** `analogReadResolution(12)` in `Sensors.cpp`; mic/light/battery are on GPIO
  34/35/36 — all **ADC1**. **ADC2 is unusable while Wi-Fi is on**, so analog sensors must never move to
  an ADC2 pin. On other chips the ADC1 GPIO set is completely different (see §6).
- **Dual-core task pinning.** `Cloud.cpp` spawns the network task with
  `xTaskCreatePinnedToCore(cloudTask, "net", 16384, …, /*core*/ 0)`; the Arduino `loop()`
  (input → FSM → render) runs on core 1. **Single-core chips (C3 / C6 / S2) have no core 1** — this call
  must change (use `xTaskCreate`, let it float, and confirm the loop still feeds the watchdog).
- **`esp_timer` countdown.** `Session.cpp` runs a 10 ms periodic `esp_timer` (`onClockTimer`) so a
  stalled main loop never skips session time. IDF API — portable across the whole family.
- **Task watchdog.** `MindBox.ino` configures `esp_task_wdt` with `trigger_panic = true` (a stalled
  loop reboots the box). Portable.
- **NVS via `Preferences`.** `Storage.cpp` uses the `"mindbox"` namespace behind a **recursive mutex**
  (NVS is not thread-safe and both cores reach it). Portable.
- **LittleFS upload queue.** `UploadQueue.cpp` stores the durable session backlog on LittleFS
  (format-on-first-boot). Requires an FS partition in the chosen scheme.
- **Wi-Fi.** `Cloud.cpp` uses `WIFI_AP_STA` (softAP captive setup portal + STA). Family-portable; the
  radio capability differs (e.g. C6 is Wi-Fi 6) but the API is the same.
- **LEDC API split (already handled).** `Haptics.cpp` guards
  `ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3,0,0)` to pick `ledcAttach` (core 3.x) vs
  `ledcSetup`/`ledcAttachPin` (core 2.x). No action needed on a chip port, but keep the guard.
- **`ESP.getEfuseMac()`.** Used for the stable device id (`Storage::makeId`) and as an RNG seed
  (`Session.cpp`). Portable.
- **I2C resilience.** `Wire` @ 400 kHz with `Wire.setTimeOut()`, plus a manual bit-bang `i2cRecover()`
  that clocks out a stuck slave. Pure GPIO/`Wire` — portable, but the recovery toggles `PIN_I2C_*`
  directly, so those pins must be normal GPIO on the target.

---

## 4. "Switch the chip" checklist (in order)

1. **Remap pins in `config.h` only.** It's the one place. For each pin verify on the *target* chip:
   input-only ranges, ADC1 membership, and strapping/boot pins to avoid.
2. **Keep analog sensors on ADC1.** Re-pick mic/light/battery pins from the target's ADC1 set
   (ADC2 + Wi-Fi don't coexist).
3. **Fix core pinning if single-core.** On C3/C6/S2 change `xTaskCreatePinnedToCore(…, 0)` in
   `Cloud.cpp` to `xTaskCreate`. `esp_timer` and the watchdog are unaffected.
4. **Display bus.** If the board uses an SPI TFT instead of the I2C OLED, **only `Display.cpp` changes** —
   the renderer is driven by a `UiModel` value, so `StateMachine`/`Menu`/everything above stays put.
   See §6.
5. **Partition scheme** with LittleFS/SPIFFS (Tools → Partition Scheme), or the queue won't mount.
6. **Serial / USB-CDC.** S3/C3/S2 expose **native USB**, so the console is USB-CDC — enable
   "USB CDC On Boot" (or wire a UART) or the `w`/`c`/`m`/`d` serial commands won't appear.
7. **Libraries** — same set as today; the LEDC version difference is already guarded.
8. **Verify** with the boot self-test (`Diagnostics::selfTest`) and the `m` live monitor: every sensor,
   the OLED/TFT, ToF, mic, and Wi-Fi should report in.

---

## 5. Per-part porting notes

- **Encoder** — the ISR is `IRAM_ATTR`; keep that (interrupt must run from IRAM). A/B pins just need
  normal GPIO with interrupt capability (all standard on the ESP32 family).
- **Side button** — needs a pull-up-capable input pin; the stuck-low guard depends on reading HIGH at
  rest. Don't place it on an input-only or strapping pin.
- **OLED / I2C** — `i2cRecover()` and the bus canary toggle SDA/SCL as plain GPIO; pick normal pins.
- **Mic / light / battery** — ADC1 only; also re-check the calibration scales after a hardware change
  (serial `c` command) since ADC reference/attenuation behavior varies by chip.
- **DHT11** — external pull-up required regardless of chip.
- **Haptic motor** — keep the high drive-strength call; if PWM is enabled, the LEDC pin must support it
  (true on all family members).
- **WS2812B ring** — needs an RMT-capable output pin and (usually) a 3V3→5V level shift; per-chip RMT
  channel availability differs but the NeoPixel library abstracts it.

---

## 6. Worked example — porting to the ESP32-S3 (Hosyond 2.8" board)

The repo already contains a sibling board sketch at
[`../MindBox - hardware ESP32 S3 screen/MindBox/MindBox.ino`](../../MindBox%20-%20hardware%20ESP32%20S3%20screen/MindBox/MindBox.ino)
— an ESP32-S3 with a 2.8" SPI **ILI9341** TFT (240×320), driven by LovyanGFX. It's currently just a
display bring-up sketch. Here's what porting the full firmware onto it involves.

**Biggest delta — the display moves from I2C OLED to SPI TFT.**
Board pinout from that sketch: SCK 12, MOSI 11, MISO 13, DC 46, CS 10, RST −1 (tied to the EN/reset
line), backlight PWM 45 (panel = `Panel_ILI9341`, bus = `Bus_SPI` on `SPI2_HOST`).
- **Action:** rewrite **only `Display.cpp`** to target LovyanGFX, dropping the SH1106/SSD1306
  auto-detect. Keep the `Display::` function signatures and the `UiModel`-driven `render()` so
  `StateMachine`, `Menu`, and the rest are untouched. This is the payoff of the existing abstraction.
- The 320×240 landscape canvas is a layout *opportunity* (more room for the timer/stats), not a
  requirement — the existing screens will render as-is.

**Free up the I2C bus.** With no OLED, the VL53L1X is the only I2C device; assign it any two free
GPIOs and update `PIN_I2C_SDA`/`PIN_I2C_SCL`. Avoid the TFT pins (10/11/12/13/46) and the backlight (45).

**Re-pin the analog sensors.** The classic ADC1 pins 34/35/36 **don't exist on the S3**. S3 ADC1 is
GPIO **1–10**; move mic/light/battery onto S3 ADC1 pins that the TFT isn't using (avoid 10/11/12/13).
Keep them on ADC1 (Wi-Fi rule still applies).

**Cores — no change.** The S3 is dual-core (LX7), so the core-0 net-task pinning in `Cloud.cpp` stays
valid.

**Strapping pins.** S3 GPIO 0 / 45 / 46 are strapping pins; this board already uses 45 (backlight) and
46 (DC) — fine since they're driven *after* boot, but don't repurpose any strapping pin as an input.

**USB-CDC.** The S3 uses native USB, so the serial console is USB-CDC — enable "USB CDC On Boot" in the
board menu so the `w`/`c`/`m`/`d` commands work.

**Net effect:** a S3 port touches `config.h` (pins) and `Display.cpp` (new driver), flips one board
setting (USB CDC), and changes nothing else. That isolation is the whole point of this layout.

---

## 7. See also

- **`config.h`** — authoritative pins, feature flags (`HAS_*`, `ENABLE_*`, `USE_*`), tunables, FW version.
- **`ARCHITECTURE.md`** — software/module design, dependency graph, sync model.
- **`CLAUDE.md`** — subsystem map (which files to open for a given task) + the threading model.
