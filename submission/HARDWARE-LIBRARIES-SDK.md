# MindBox — Hardware, Libraries & SDK (basic documentation)

Covers the course's "basic documentation" requirement: **library names + versions, SDK version,
connection diagram**. Pin/flag source of truth: `MindBox - hardware ESP32 S3 screen/MindBox/src/config.h`.

> `⟨fill: …⟩` = read the exact installed version from your Arduino IDE (Boards Manager / Library
> Manager) and paste it. Everything else is verified from the code/datasheet.

---

## 1. SDK / toolchain

| Item | Value |
|---|---|
| MCU / board | **ESP32-S3** on **LCDWIKI ES3C28P/ES3N28P** 2.8" touch board (datasheet CR2025-MI6890) |
| IDE | Arduino IDE |
| **ESP32 Arduino core (SDK)** | `esp32` by Espressif — **version ⟨fill: e.g. 3.0.x⟩** |
| Web app runtime | Node ⟨fill: `node -v`⟩ / Bun (canonical, `bun.lock`) |

**Arduino board settings (must match, from the datasheet):**
Board = **ESP32S3 Dev Module** · USB CDC On Boot = **Enabled** · Flash Size = **16 MB** ·
Partition Scheme = **"Huge APP (3 MB No OTA / 1 MB SPIFFS)"** · PSRAM = **"OPI PSRAM"** · Upload/Monitor
speed = **115200**.

---

## 2. Firmware libraries (Arduino Library Manager)

| Library | Used for | Gated by | Version |
|---|---|---|---|
| **LovyanGFX** | ILI9341 TFT via SPI + sprite/DMA | display (always) | ⟨fill⟩ |
| **AiEsp32RotaryEncoder** | KY-040 rotary encoder | `HAS_ENCODER=1` | ⟨fill⟩ |
| **Adafruit VL53L1X** | ToF presence sensor | `HAS_PRESENCE=1` | ⟨fill⟩ |
| **DHT sensor library** | DHT11 temp/humidity | `HAS_TEMP=1` | ⟨fill⟩ |
| **Adafruit Unified Sensor** | dependency of DHT lib | `HAS_TEMP=1` | ⟨fill⟩ |
| *(Adafruit NeoPixel)* | external WS2812B ring | `HAS_LED_RING=1` (**OFF**) | n/a |

**No library** for: FT6336 capacitive touch (custom driver over Arduino `Wire` in `Touch.cpp`), and the
ES8311 I2S audio codec (driven directly in `Audio.cpp`).

**Web app dependencies + versions:** pinned in
`mindbox-companion-forge-main/package.json` (React 19, TanStack Start/Router, Supabase JS, Recharts,
Zod, puppeteer, `@google/genai`, etc.) and `bun.lock` — that file **is** the versioned manifest.

---

## 3. Connection diagram

Machine-readable schematic: **`MindBox - hardware ESP32 S3 screen/MindBox/diagram.json`** (Wokwi),
documented in `README-WOKWI.md`. Per-part wiring: `docs/WIRING.md` (+ `WIRING.pdf`). Verified pin map:

| Subsystem | Part | Bus / protocol | Pins (GPIO) |
|---|---|---|---|
| Display | ILI9341 TFT | SPI2 @40 MHz + DMA | SCK 12, MOSI 11, MISO 13, DC 46, CS 10, RST −1(EN), BL 45 |
| Touch | FT6336 | I2C 0x38 @400 kHz | SDA 16, SCL 15, INT 17, RST 18 |
| Presence | VL53L1X ToF | I2C 0x29 (shared bus) | SDA 16, SCL 15 |
| Mic | ES8311 (I2S) | I2S | DIN **6**, BCLK 5, LRCK 7, MCLK 4 |
| Speaker | ES8311 DAC → FM8002E amp | I2S | DOUT **8**, AMP_EN 1 (active-low) |
| Codec control | ES8311 | soft-I2C 0x18 (boot only) | SDA 16, SCL 15 |
| Encoder | KY-040 | quadrature (ISR) | CLK **2**, DT **14**, SW −1 |
| Side button | encoder shaft | digital (active-low) | **21** (shared with DHT11) |
| Temp/Humidity | DHT11 | 1-wire | DATA **21** (+ 4.7k–10k pull-up) |
| Light | KY-018 | analog ADC1 | AO **3** |
| BOOT button | onboard | digital | 0 |

**Only 4 header GPIO exist (IO2, IO3, IO14, IO21)** — hence IO21 is double-booked (encoder button +
DHT11). Onboard-but-unused: RGB LED IO42, battery ADC IO9, SD 38/40/39/41/47/48.

**Disabled peripherals** (`config.h`): `HAS_LED_RING=0`, `HAS_HAPTIC=0`, `HAS_BATTERY=0`,
`USE_SPDT_TOGGLE=0` — replaced by the TFT screen + I2S speaker (see `submission/DEMO-PLAN.md §2`).

---

## 4. Where the rest of the documentation lives (all in Git)

- Firmware subsystem map + threading + brownout notes: `MindBox - hardware ESP32 S3 screen/MindBox/CLAUDE.md`
- S3-accurate wiring: `.../MindBox/docs/WIRING.md` (+ `WIRING.pdf`)
- Full Hebrew system guide (hardware, cores, protocol, proof playbook): `mindbox-companion-forge-main/docs/`
- Web app architecture: `mindbox-companion-forge-main/CLAUDE.md`
- Algorithm evaluation: `submission/ALGORITHM-EVALUATION.md`
- Demo run-of-show: `submission/DEMO-PLAN.md`
