# MindBox — Wokwi diagram

`diagram.json` is a Wokwi schematic of the MindBox ESP32-S3 wiring. Open it on
[wokwi.com](https://wokwi.com) (New Project → ESP32-S3, then paste/replace `diagram.json`) to view the
circuit. Pins follow `src/config.h` — `config.h` is the source of truth; this diagram tracks it.

## Parts and how they map to the real board

| Diagram part | Represents | Notes |
|---|---|---|
| `board-esp32-s3-devkitc-1` | ESP32-S3 MCU | Stand-in for the LCDWIKI ES3C28P/ES3N28P board. BOOT (IO0) and RESET are the devkit's own onboard buttons. |
| `wokwi-ili9341` | 2.8" ILI9341 TFT | SPI2. `RST` is tied to 3V3 (real board ties it to chip EN; Wokwi doesn't simulate RST). |
| `wokwi-ky-040` | KY-040 rotary encoder | `CLK→IO2`, `DT→IO14`. Its `SW` (shaft button) goes to **IO21** — the firmware reads it as the side button, not via the encoder lib. |
| `wokwi-photoresistor-sensor` | KY-018 light sensor | Analog `AO→IO3` (ADC1). |
| `wokwi-dht22` | **DHT11** temp/humidity | Stand-in — Wokwi has no `wokwi-dht11`; identical 1-wire pinout. `DATA→IO21`. |
| `wokwi-mpu6050` | **VL53L1X** ToF presence | Stand-in — Wokwi has no VL53L1x/0x part. Used only as a generic I2C device on the shared bus (`SDA→IO16`, `SCL→IO15`). |
| `wokwi-buzzer` | ES8311 codec + FM8002E amp → speaker | Stand-in for the I2S audio path; wired to the codec's I2S `DOUT→IO8`. |
| `wokwi-resistor` ×3 | Pull-ups | `r1` 10k on IO21 (button/DHT); `r2`,`r3` 4.7k on the I2C SDA/SCL lines. |

## Wiring (matches `src/config.h`)

- **Display (SPI2):** SCK `IO12`, MOSI `IO11`, MISO `IO13`, D/C `IO46`, CS `IO10`, backlight `IO45`,
  VCC 3V3, GND.
- **Encoder (KY-040):** CLK `IO2`, DT `IO14`, shaft-button SW `IO21`, VCC 3V3, GND.
- **IO21 is double-booked** (as on the real board): the encoder shaft button *and* the DHT11 data line
  share it. One 10k pull-up to 3V3 (`r1`) holds the active-low button high and pulls up the DHT line.
- **DHT11:** DATA `IO21`, VCC 3V3, GND.
- **Light (KY-018):** AO `IO3`, VCC 3V3, GND.
- **ToF (VL53L1X):** SDA `IO16`, SCL `IO15`, VCC 3V3, GND — the **shared touch I2C bus** (single master;
  ToF `0x29`, touch `0x38`). 4.7k pull-ups (`r2`,`r3`) on SDA/SCL.
- **Speaker:** I2S DOUT `IO8` → buzzer, other leg to GND.

## Not modeled (onboard parts with no Wokwi equivalent)

- **FT6336 capacitive touch** (`0x38`, I2C on IO16/IO15, INT `IO17`, RST `IO18`) — onboard; Wokwi's
  ILI9341 only has resistive (XPT2046) touch, a different controller, so touch is left out.
- **Full ES8311 codec control path** (I2C `0x18`, boot-only, on the touch SDA/SCL) and the FM8002E amp
  enable (`AMP_EN IO1`, active-low) — only the I2S audio output is represented (by the buzzer).
- **RGB LED `IO42`** and **battery sense `IO9`** — onboard, not driven by the firmware.
