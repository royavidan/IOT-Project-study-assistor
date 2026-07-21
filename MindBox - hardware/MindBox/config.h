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
#define HAS_LIGHT       1   // Keyes KY-018 photoresistor (AO -> ADC)
#define HAS_TEMP        1   // DHT11 temp/humidity (DATA on GPIO 26)
#define HAS_BATTERY     0   // LiPo divider on an ADC pin (not present yet)
#define ENABLE_WIFI     1   // Wi-Fi join + NTP (provision over serial: 'w')
#define ENABLE_CLOUD    1   // requires ENABLE_WIFI; ingest upload + config pull

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
#define PIN_DHT11     26    // DHT11 DATA (needs 4.7k–10k pull-up to 3V3)
#define PIN_LIGHT_ADC 35    // KY-018 AO, ADC1 (input-only)
#define PIN_SPDT      32    // optional Work/Break toggle
#define PIN_LED_RING   5    // WS2812B data (TODO confirm; needs 5V + 470R + 1000uF)
#define PIN_BATTERY_ADC 36  // LiPo divider when HAS_BATTERY=1 (GPIO 35 = KY-018)

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
static const unsigned long SAMPLE_PERIOD_MS          = 60000UL;   // WORK, coaching off
static const unsigned long SAMPLE_PERIOD_COACHING_MS = 30000UL; // WORK, adaptive coaching on
static const unsigned long SAMPLE_PERIOD_BREAK_MS    = 120000UL; // BREAK blocks
// Checkpoints are saved on pause/resume/start/end — not on a timer (avoids flash stalls).
static const int           PRESENCE_NEAR_MM   = 700;      // <= this == "at the desk"
static const unsigned long PRESENCE_PAUSE_MS  = 30000UL;  // absent this long -> PAUSE
static const unsigned long PRESENCE_END_MS    = 300000UL; // absent 5 min -> auto-end
// Sensor calibration defaults (overridable at runtime via NVS — serial 'c' command).
static const float         NOISE_FULL_SCALE_DEFAULT = 2000.0f;  // mic ADC p-p -> 1.0
static const float         LIGHT_LUX_SCALE_DEFAULT  = 1000.0f;  // KY-018 ADC -> lux estimate
static const float         LIGHT_VAR_SCALE_DEFAULT  = 2000.0f;  // light ADC p-p -> FLE variance
static const float         TEMP_OFFSET_DEFAULT      = 0.0f;     // DHT11 bias correction (°C)
static const unsigned long DHT_READ_INTERVAL_MS = 2000UL; // DHT11 minimum between reads
static const int           FLE_PRESENCE_CAP   = 5;        // matches focus-load.ts
static const int           FLE_ADAPTIVE_BREAK = 75;       // Story 16 threshold
static const unsigned long COACHING_COOLDOWN_MS = 300000UL; // 5 min between nudges
// Performance: 120 samples ≈ 2 h at 1/min — halves session RAM + upload JSON vs 240 (~8/10 crash win).
static const int           MAX_SAMPLES        = 120;
#define CHECKPOINT_TAIL_MAX 10                  // last N env samples in NVS checkpoint
static const float         TEMP_MIN_VALID     = -20.0f;   // Story 18 clamp range
static const float         TEMP_MAX_VALID     = 60.0f;
static const unsigned long TELEMETRY_PERIOD_MS = 60000UL; // 60 s: half the HTTP load vs 30 s (balanced profile)
static const unsigned long SESSION_CLOCK_MS    = 10UL;     // esp_timer tick for countdown
static const unsigned long TOF_POLL_MS         = 200UL;    // less I2C contention with OLED vs 100 ms
static const unsigned long WIFI_STATUS_CACHE_MS = 1000UL;  // throttle WiFi.status()

// ---- connectivity (ENABLE_WIFI / ENABLE_CLOUD) -----------------------------
// CLOUD_USE_TLS pulls in WiFiClientSecure/mbedtls — a very heavy compile that can
// exhaust the host toolchain's memory. Leave 0 for an http dev server; set to 1
// only when the app is served over https (and expect a slower build).
#define CLOUD_USE_TLS 0
#define NTP_SERVER "pool.ntp.org"
// On-box Wi-Fi setup portal (SoftAP + captive page). The box hosts this open AP
// so a phone can pick a network + password with no laptop/reflash. Open AP is the
// standard captive-portal trade-off, bounded by the timeout (set a softAP password
// in Cloud.cpp if you want to lock it).
#define WIFI_AP_SSID "MindBox-Setup"
static const unsigned long PORTAL_TIMEOUT_MS = 300000UL;  // auto-exit setup AP after 5 min
static const unsigned long CONFIG_FETCH_MS = 60000UL;    // pull settings every 60 s when online
static const unsigned long CONFIG_FETCH_PAIRING_MS = 3000UL; // 3 s: ~83% less HTTP than 500 ms while pairing
static const unsigned long CONFIG_FETCH_UNPAIRED_MS = 5000UL; // idle + online but not linked yet
static const unsigned long WIFI_RETRY_MS   = 15000UL;    // reconnect attempt cadence
// HTTP is synchronous on the main loop, so a stalled request freezes the UI.
// Keep these tight and back off after a failure so an unreachable server can't
// repeatedly stall the loop.
static const int           HTTP_TIMEOUT_MS = 3000;       // read timeout per request
static const int           HTTP_CONNECT_TIMEOUT_MS = 1500; // cap the hang to an unreachable host
static const unsigned long NET_FAIL_BACKOFF_MS = 30000UL;  // after connect/timeout fail, skip HTTP this long
static const unsigned long NET_TASK_PERIOD_MS  = 200UL;    // core-0 net task loop cadence
static const unsigned long SERVER_TODAY_TTL_MS = 180000UL; // prefer the server's today total if this fresh
static const unsigned long SIGN_OUT_GUARD_MS   = 90000UL;  // after a box sign-out, ignore stale paired:true this long

// ---- upload queue (LittleFS Part B) ----------------------------------------
// Requires a partition scheme with SPIFFS/LittleFS (Arduino IDE: Tools → Partition Scheme).
static const int           UPLOAD_QUEUE_MAX     = 12;    // drop-oldest when full
static const unsigned long UPLOAD_RETRY_MIN_MS  = 5000UL;
static const unsigned long UPLOAD_RETRY_MAX_MS  = 300000UL; // 5 min cap

// ---- reliability -----------------------------------------------------------
static const unsigned long WDT_TIMEOUT_MS = 15000UL;  // task watchdog: reboot if the loop stalls
static const unsigned long I2C_HEALTH_MS  = 2000UL;   // ToF bus-canary ping cadence
static const uint16_t      I2C_TIMEOUT_MS = 50;       // Wire transaction timeout (never hang)

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
