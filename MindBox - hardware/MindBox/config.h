#pragma once
#include <stdint.h>
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
#define PIN_BUTTON     4    // 6x6x3.6mm tact (diagonal pins): one leg here, one to GND
                              // NOT GPIO 34-39 — those have no internal pull-up
#define BTN_ACTIVE_LOW 1    // 1 = press connects to GND (use INPUT_PULLUP)
                              // 0 = press connects to 3V3 (use INPUT_PULLDOWN)
// Motor driver input (NPN/MOSFET base). DO NOT use GPIO 2 on DOIT DevKit V1 —
// it shares the onboard blue LED and motor drive will stay weak. Use GPIO 25.
#define PIN_HAPTIC    25
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
static const int           CYCLE_MIN          = 1;
static const int           CYCLE_MAX          = 8;
static const int           CYCLE_DEFAULT      = 4;
static const int           GOAL_MIN_MIN       = 30;
static const int           GOAL_MAX_MIN       = 480;
static const int           GOAL_STEP_MIN      = 30;
static const int           GOAL_DEFAULT_MIN   = 180;
static const unsigned long SETUP_TIMEOUT_MS   = 12000UL;  // setup/armed idle -> IDLE
static const unsigned long SENSOR_WARMUP_MS   = 5000UL;   // Story 18: ignore reads post-boot
static const unsigned long SAMPLE_PERIOD_MS   = 60000UL;  // Story 8/10: 1-min samples
static const unsigned long CHECKPOINT_PERIOD_MS = 30000UL; // NVS save while session active
static const int           PRESENCE_NEAR_MM   = 700;      // <= this == "at the desk"
static const unsigned long PRESENCE_PAUSE_MS  = 30000UL;  // absent this long -> PAUSE
static const unsigned long PRESENCE_END_MS    = 300000UL; // absent 5 min -> auto-end
static const float         NOISE_FULL_SCALE   = 2000.0f;  // ADC peak-to-peak -> 1.0 (tune)
static const int           FLE_PRESENCE_CAP   = 5;        // matches focus-load.ts
static const int           FLE_ADAPTIVE_BREAK = 75;       // Story 16 threshold
static const unsigned long COACHING_COOLDOWN_MS = 300000UL; // 5 min between nudges
static const int           MAX_SAMPLES        = 240;      // ~4h at 1/min
static const float         TEMP_MIN_VALID     = -20.0f;   // Story 18 clamp range
static const float         TEMP_MAX_VALID     = 60.0f;
static const unsigned long TELEMETRY_PERIOD_MS = 15000UL;

// ---- haptics (GPIO 2 → NPN/MOSFET → motor on 5V; 3.3V GPIO drives base/gate) --
#define HAPTIC_USE_PWM  0     // 0 = steady HIGH on "on" steps (try 1 + ~150 Hz if weak)
static const uint32_t      HAPTIC_FREQ_HZ       = 150;    // ERM coin-motor band (if PWM on)
static const uint8_t       HAPTIC_DUTY          = 255;
static const uint8_t       HAPTIC_BURST_N       = 4;      // pulses in enable/test burst
static const uint16_t      HAPTIC_BURST_ON_MS   = 550;  // each burst "on" phase
static const uint16_t      HAPTIC_BURST_GAP_MS  = 140;
static const uint16_t      HAPTIC_MS_CLICK      = 100;
static const uint16_t      HAPTIC_MS_TAP        = 500;
static const uint16_t      HAPTIC_MS_ENABLE_TEST = 550; // legacy alias = BURST_ON
static const uint16_t      HAPTIC_MS_PAUSE      = 220;
static const uint16_t      HAPTIC_MS_PAUSE_GAP  = 140;
static const uint16_t      HAPTIC_MS_RESUME     = 600;
static const uint16_t      HAPTIC_MS_COMPLETE   = 700;
static const uint16_t      HAPTIC_MS_COMPLETE_GAP = 200;
static const uint16_t      HAPTIC_MS_RESET      = 750;
static const uint16_t      HAPTIC_TEST_HOLD_MS  = 3000; // Test motor: steady ON (full power)

// ---- side tactile button (GPIO 4) timing -----------------------------------
static const unsigned long BTN_DEBOUNCE_MS      = 50UL;
static const unsigned long BTN_SHORT_MIN_MS     = 30UL;
static const unsigned long BTN_LONG_MS          = 500UL;
