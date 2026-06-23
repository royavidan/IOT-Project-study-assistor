# MindBox — wiring guide (LCDWIKI ES3C28P/ES3N28P ESP32‑S3 board)

How every component connects on the **actual board** (the one in the build photo). Pin facts here are
read off the board's own silkscreen + `src/config.h`. If anything here ever disagrees with `config.h`,
`config.h` wins.

> **TL;DR to just make it run:** plug in the **USB‑C cable**. The display, touch, RGB LED, and audio amp
> are already on the board — nothing else has to be wired. Everything below is only for adding sensors.

---

## 1. The connectors on this board (from the silkscreen)

| Connector | Pins (in order) | Notes |
|---|---|---|
| **GPIO header** (left 4‑pin JST) | `IO2` · `IO3` · `IO14` · `IO21` | General GPIO. **Signals only — no power pins here.** |
| **I2C header** (middle 4‑pin JST, "I2C") | `3.3V` · `GND` · `IO15 (SCL)` · `IO16 (SDA)` | ⚠ **This is the capacitive‑touch bus** (FT6336 @ `0x38`). Use it for **power taps (3.3V/GND)** freely; sharing it for another I2C device needs care (see §5). |
| **SPEAKER** (right 2‑pin JST) | speaker + / − | Onboard audio amplifier output. Not used by the firmware today. |
| **USB‑C** | 5V power + USB | Power and flashing/serial. The only cable you actually need. |
| **RESET** / **BOOT** buttons | — | BOOT = `IO0` (firmware: short‑tap toggles dark/light theme; long‑hold recalibrates touch). |
| **RGB LED** (white square, top) | `IO42` (onboard) | Onboard status LED; not required. |

---

## 2. Already on the board — DO NOT wire these

| Component | How it's connected (internal) |
|---|---|
| **2.8" ILI9341 display** | SPI: SCK `IO12`, MOSI `IO11`, MISO `IO13`, DC `IO46`, CS `IO10`, backlight `IO45`. (Orange ribbon cable.) |
| **FT6336 capacitive touch** | I2C @ `0x38`: SDA `IO16`, SCL `IO15`, INT `IO17`, RST `IO18`. |
| **Audio amp + SPEAKER** | Onboard I2S amp on `IO4–IO8` region → SPEAKER connector. |
| **RGB LED, USB‑C, RESET, BOOT** | Onboard. |

These are why the unit works with just USB‑C.

---

## 3. Power for external sensors

The GPIO header has **no power pins**, so take **3.3V and GND from the I2C header** (its first two pins).
- **Always power sensors from `3.3V`, never 5V** — the ESP32‑S3 ADC and GPIOs are 3.3V; 5V can clip the
  signal or damage a pin.

---

## 4. The golden rules for picking a pin (this board)

| Rule | Why |
|---|---|
| **Analog sensors (mic / light / battery) → `IO2` or `IO3` only** | Analog needs **ADC1 = GPIO 1–10**. On the exposed header only IO2/IO3 qualify. |
| `IO14`, `IO21` are **digital‑only** for us | IO14 is ADC2 (unusable while Wi‑Fi is on); IO21 isn't an ADC pin. Fine for digital inputs/switches. |
| The **I2C header is the touch bus** | Another I2C device there must (a) not use address `0x38`, and (b) share the touch port in firmware — non‑trivial. Prefer the GPIO header for new parts. |
| Wi‑Fi is **2.4 GHz only** | The S3 radio can't see 5 GHz networks. |

---

## 5. Component → connection map

Set the matching line in `src/config.h`, then flip its `HAS_*` flag to `1` and reflash.

### Microphone (analog module — e.g. MAX9814 / MAX4466)  ← the one you have
| Mic pin | Connects to | Header |
|---|---|---|
| `VCC` | **3.3V** | I2C header, pin 1 |
| `GND` | **GND** | I2C header, pin 2 |
| `OUT` / `AO` | **IO2** | GPIO header, pin 1 |

Firmware: in `src/config.h` set `#define PIN_MIC 2` and `#define HAS_MIC 1`. Reflash, then in Serial
Monitor (115200) press **`c`** to calibrate the noise level and **`m`** to watch it live. This lights up
the **"noise high" interference alert** and the Noise toggle/threshold in Settings → Environment.

*(If IO2 is awkward, IO3 works the same — just set `PIN_MIC 3`.)*

### Optional add‑ons (not wired yet — for reference)
| Component | Wire to | config.h | Notes |
|---|---|---|---|
| Light sensor (KY‑018, analog) | `OUT→IO3`, VCC→3.3V, GND→GND | `PIN_LIGHT_ADC 3`, `HAS_LIGHT 1` | ADC1 pin; can't share IO2 with the mic — pick the other one. |
| DHT11 temp/humidity (1‑wire) | `DATA→IO21`, VCC→3.3V, GND→GND | `PIN_DHT11 21`, `HAS_TEMP 1` | Needs a 4.7k–10k pull‑up from DATA to 3.3V. Digital pin OK. |
| VL53L1X presence (I2C) | `SDA→IO16`, `SCL→IO15`, VCC→3.3V, GND→GND (I2C header) | `HAS_PRESENCE 1` | Shares the **touch bus** (addr `0x29` ≠ touch `0x38`). Needs firmware to read it on the touch I2C port — ask before relying on this. |
| Haptic motor | via a transistor/MOSFET driver + flyback diode; gate→`IO21` (or IO2/3 if free), motor on its own 5V | `PIN_HAPTIC 21`, `HAS_MIC`/others as needed | **Never drive a motor straight from a GPIO.** |

Two analog sensors at once → one on **IO2**, the other on **IO3** (those are the only two ADC1 pins on
the header).

---

## 6. Speaker

The SPEAKER connector is the board's onboard audio amplifier. The current firmware has **no audio
output code**, so it does nothing yet — leave it connected or not; it won't affect anything.

---

## 7. Don'ts / common traps

- ❌ Don't power a sensor from 5V — use the **3.3V** pin.
- ❌ Don't put an analog sensor on `IO14` or `IO21` — readings will be wrong (not ADC1). Use `IO2`/`IO3`.
- ❌ Don't hang a random I2C device on the "I2C" header expecting a free bus — it's the **touch** bus.
- ❌ Don't drive a motor/relay directly from a GPIO — use a driver transistor.
- ✅ After wiring any part: set its pin + flip `HAS_*` in `src/config.h`, reflash, verify with serial
  `m` (live monitor) / `d` (dump) / `c` (calibrate).

---

## 8. Build/flash settings (Arduino IDE) — needed for it to run at all

Board **ESP32S3 Dev Module** · **USB CDC On Boot = Enabled** · Flash **16MB** · Partition **Huge APP
(3MB No OTA/1MB SPIFFS)** · **PSRAM = OPI PSRAM** · Upload/Monitor **115200**. Wi‑Fi is set up on the
device under **Device → Wi‑Fi Setup** (scan + on‑screen keyboard), or over serial with `w`.
