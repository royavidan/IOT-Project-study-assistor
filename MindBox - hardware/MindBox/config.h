#pragma once
// ============================================================================
// config.h — the ONE place to change pins, feature flags, and tunables.
// Every module includes this; nothing else hard-codes a pin or a threshold.
// ============================================================================

// ---- firmware identity -----------------------------------------------------
#define FW_VERSION "0.2.0"

// ---- feature flags: flip 0 -> 1 as each part / link is wired up ------------
#define USE_SPDT_TOGGLE 0   // physical Work/Break switch on GPIO 32
#define HAS_PRESENCE    1   // VL53L1X ToF (validated by Unit Tests/lazer)
#define HAS_LED_RING    0   // WS2812B ring (not present yet)
#define HAS_LIGHT       0   // light sensor (not chosen/tested yet)
#define HAS_TEMP        0   // temperature sensor (not chosen/tested yet)
#define HAS_BATTERY     0   // LiPo divider on an ADC pin (not present yet)
#define ENABLE_WIFI     0   // Wi-Fi join + NTP (offline-first until ready)
#define ENABLE_CLOUD    0   // requires ENABLE_WIFI; ingest upload + config pull

// ---- pin map (single source of truth) -------------------------------------
#define PIN_ENC_CLK   18    // KY-040 A
#define PIN_ENC_DT    19    // KY-040 B
#define PIN_ENC_SW    23    // KY-040 shaft button (NOT 21 — 21 is I2C SDA)
#define PIN_I2C_SDA   21
#define PIN_I2C_SCL   22
#define PIN_BUTTON     4    // side tactile button, INPUT_PULLUP to GND
#define PIN_HAPTIC     2    // motor driver input (transistor + flyback; boot pin)
#define PIN_MIC       34    // GY-MAX9814 OUT, ADC1 (input-only)
#define PIN_SPDT      32    // optional Work/Break toggle
#define PIN_LED_RING   5    // WS2812B data (TODO confirm; needs 5V + 470R + 1000uF)
// #define PIN_BATTERY_ADC 35

// ---- LED ring --------------------------------------------------------------
#define LED_COUNT 16

// ---- OLED ------------------------------------------------------------------
#define OLED_W 128
#define OLED_H 64
#define OLED_WHITE 1        // both SH110X_WHITE and SSD1306_WHITE == 1

// ---- tunables --------------------------------------------------------------
static const int           DUR_STEP_MIN       = 5;        // Story 3: 5-min detents
static const int           DUR_MIN_MIN        = 5;
static const int           DUR_MAX_MIN        = 120;
static const int           DUR_DEFAULT_MIN    = 25;
static const unsigned long SETUP_TIMEOUT_MS   = 12000UL;  // setup/armed idle -> IDLE
static const unsigned long SENSOR_WARMUP_MS   = 5000UL;   // Story 18: ignore reads post-boot
static const unsigned long SAMPLE_PERIOD_MS   = 60000UL;  // Story 8/10: 1-min samples
static const int           PRESENCE_NEAR_MM   = 700;      // <= this == "at the desk"
static const unsigned long PRESENCE_PAUSE_MS  = 30000UL;  // absent this long -> PAUSE
static const unsigned long PRESENCE_END_MS    = 300000UL; // absent 5 min -> auto-end
static const float         NOISE_FULL_SCALE   = 2000.0f;  // ADC peak-to-peak -> 1.0 (tune)
static const int           FLE_PRESENCE_CAP   = 5;        // matches focus-load.ts
static const int           FLE_ADAPTIVE_BREAK = 75;       // Story 16 threshold
static const int           MAX_SAMPLES        = 240;      // ~4h at 1/min
static const float         TEMP_MIN_VALID     = -20.0f;   // Story 18 clamp range
static const float         TEMP_MAX_VALID     = 60.0f;
static const unsigned long TELEMETRY_PERIOD_MS = 15000UL;
