#pragma once
#include <stdint.h>
// ============================================================================
// config.h — single source of truth for the S3 MindBox firmware: pins, build
// flags, and tunables. Every module includes this; nothing else hard-codes a
// pin or threshold. (S3 port of the sibling firmware's config.h.)
//
// Peripheral pins below the display/touch block are S3-VALID PLACEHOLDERS chosen
// per docs/HARDWARE.md §6 (analog on ADC1 = GPIO 1–10, away from the TFT/touch/
// backlight pins). They are gated by HAS_* = 0 — set the real pin + flip the flag
// when that part is actually wired.
// ============================================================================

#define FW_VERSION "0.2.0-s3"

// ============================================================================
// Build variants / feature flags  (flip 0 -> 1 as each part / link is wired up)
// ============================================================================
#ifndef USE_TOUCH
#define USE_TOUCH 1         // XPT2046 touchscreen UI + navigation (default)
#endif
#ifndef HAS_ENCODER
#define HAS_ENCODER 1       // KY-040 rotary encoder + shaft button (CLK=IO2, DT=IO14, SW=IO48). Needs the AiEsp32RotaryEncoder library. Coexists with touch.
#endif

#define USE_SPDT_TOGGLE 0   // physical Work/Break switch
#define HAS_MIC         0   // legacy ANALOG mic path (retired — board mic is digital I2S; see HAS_I2S_MIC)
#define HAS_I2S_MIC     1   // ES8311 I2S MEMS mic, DIN=IO6 — board's ONLY mic. (raises boot current — if the box reboot-loops on a weak USB supply, set back to 0)
#define HAS_SPEAKER     1   // ES8311 I2S + FM8002E amp -> speaker connector (DOUT=IO8, AMP_EN=IO1 active-low). Boot beep confirms it; session chimes gated by Settings -> Sound.
#define HAS_ANY_MIC     (HAS_MIC || HAS_I2S_MIC)   // any mic source present (gates noise UI/telemetry)
#define HAS_PRESENCE    1   // VL53L1X/TOF400C ToF on the shared touch I2C bus IO16/15. SINGLE MASTER: the FT6336 touch is now read directly over Arduino Wire (Touch.cpp), so touch (0x38) and ToF (0x29) are two devices on ONE I2C master — no two-master pad contention (the prior pad-swap approach killed touch). LovyanGFX's own touch driver is removed (Panel.*); on first boot the screen runs a 4-corner calibration that learns the orientation. Adds boot current; needs a solid 5V supply.
#define HAS_LED_RING    0   // WS2812B ring
#define HAS_HAPTIC      0   // vibration motor — REMOVED. Disables the haptic driver so it never drives PIN_HAPTIC. Set 1 (+ a real free pin) to restore.
#define HAS_LIGHT       1   // Keyes KY-018 photoresistor AO -> IO3 (ADC1); see docs/WIRING.md §5
#define HAS_TEMP        1   // DHT11 temp/humidity DATA -> IO21 (needs 4.7k–10k pull-up to 3V3)
#define HAS_BATTERY     0   // LiPo divider on an ADC pin
#define ENABLE_WIFI     1   // Wi-Fi join + NTP (provision over serial: 'w')
#define ENABLE_CLOUD    1   // requires ENABLE_WIFI; ingest upload + config pull

// ============================================================================
// Display: ILI9341 on SPI2  (the one block that is actually wired)
// ============================================================================
#define TFT_SPI_HOST   SPI2_HOST
#define PIN_TFT_SCLK   12
#define PIN_TFT_MOSI   11
#define PIN_TFT_MISO   13
#define PIN_TFT_DC     46
#define PIN_TFT_CS     10
#define PIN_TFT_RST    -1      // tied to the EN/reset line
#define PIN_TFT_BL     45      // PWM backlight
#define TFT_PANEL_W    240
#define TFT_PANEL_H    320
#define SCR_ROTATION   1       // landscape -> 320 x 240
#define SCR_W          320
#define SCR_H          240

// Legacy OLED dims kept only so any ported screen helper that references them
// still compiles; the TFT renderer uses SCR_W/SCR_H.
#define OLED_W 128
#define OLED_H 64
#define OLED_WHITE 1

// ============================================================================
// Touch: FT6336 CAPACITIVE controller on I2C  (LCDWIKI ES3C28P/ES3N28P board)
// ============================================================================
#define TOUCH_I2C_PORT 1        // own port; keeps Wire (port 0) free for a future ToF
#define TOUCH_I2C_ADDR 0x38
#define PIN_TOUCH_SDA  16       // TP_SDA
#define PIN_TOUCH_SCL  15       // TP_SCL
#define PIN_TOUCH_INT  17       // TP_INT
#define PIN_TOUCH_RST  18       // TP_RST (pulsed in Panel::begin)
#define TOUCH_FREQ     400000
#define TOUCH_OFFSET_ROTATION 0 // bump 0..7 if the touch axes come out swapped/mirrored

// ============================================================================
// Audio: ES8311 codec + FM8002E amp on I2S  (LCDWIKI ES3C28P/ES3N28P board)
//   Codec CONTROL is I2C 0x18 on the SAME pins as touch (IO16/IO15). It is done
//   once at boot via software-I2C (Audio::beginCodec) BEFORE LovyanGFX claims the
//   bus; at runtime audio is I2S-only (no codec I2C), so no touch-bus contention.
//   Volume is set by scaling I2S samples in software, never by codec re-writes.
// ============================================================================
#define PIN_I2S_MCLK   4         // I2S master clock
#define PIN_I2S_BCLK   5         // I2S bit clock (SCK)
#define PIN_I2S_DOUT   8         // I2S data OUT -> speaker (DAC).  ngttai BSP GPIO8 (datasheet's "I2S_DI")
#define PIN_I2S_LRCK   7         // I2S word select (LRC)
#define PIN_I2S_DIN    6         // I2S data IN  <- MIC (ADC).  ngttai BSP GPIO6 (datasheet's "I2S_DO" =
                                 //   codec ADC data-OUT = mic). We had this swapped with DOUT, so we were
                                 //   reading the undriven speaker line on IO8 -> constant 0xFFFF/-1.
#define PIN_AMP_EN     1         // FM8002E amp enable — ACTIVE-LOW (low=on, high=mute)
#define ES8311_ADDR    0x18      // codec I2C address (7-bit)
#define PIN_CODEC_SDA  16        // == PIN_TOUCH_SDA  (shared touch bus, boot-only soft-I2C)
#define PIN_CODEC_SCL  15        // == PIN_TOUCH_SCL
#define AUDIO_SAMPLE_RATE 16000  // Hz; 16-bit mono (mic RMS sensing + chime tones)
// AC-component RMS (DC bias removed) that maps to noise=1.0. LOWER = more sensitive.
// 6000 was tuned for the old raw-RMS (DC-included) math and maps real speech to ~0% now.
// Start sensitive so a working mic is visibly non-zero, then tune via serial 'a'.
static const float AUDIO_MIC_RMS_FULL = 1000.0f;

// ============================================================================
// Peripheral pin map (S3 placeholders — gated by HAS_*; see header note)
//
// ⚠ On the LCDWIKI ES3C28P/ES3N28P these GPIOs are mostly TAKEN by onboard
// peripherals: touch I2C (15/16/17/18), I2S audio (4–8), SD-card (38–41,47,48),
// RGB-LED (42), battery ADC (9). The values below are inert placeholders (all
// HAS_*=0). When you actually wire a part, re-pick a genuinely FREE GPIO and
// avoid the touch pins. Real battery sense, if used, is BAT_ADC = IO9.
// ============================================================================
// This board breaks out ONLY 4 GPIO (GPIO header: IO2, IO3, IO14, IO21 — see docs/WIRING.md §1).
// The encoder (HAS_ENCODER=1) takes the two freed by removing the ToF (IO2/IO14) for rotation.
// SW = -1 (no shaft button): there's no 4th free header pin (IO3=light, IO21=temp), and touch already
// does select/back. To add the shaft press, free IO3 (HAS_LIGHT=0) or IO21 (HAS_TEMP=0) and set it here.
#define PIN_ENC_CLK    2    // KY-040 A (CLK) — ex-ToF SDA (GPIO header)
#define PIN_ENC_DT    14    // KY-040 B (DT)  — ex-ToF SCL (GPIO header)
#define PIN_ENC_SW    -1    // KY-040 shaft button is NOT read via the encoder lib (its isEncoderButtonClicked() busy-waits ~330ms). The SW wires to IO21 and is handled by pollSideButton (PIN_BUTTON). Keep -1.
#define PIN_I2C_SDA   16    // ToF + FT6336 touch SHARED I2C SDA (IO16). ONE Arduino Wire master: touch 0x38 (Touch.cpp), ToF 0x29 (Sensors.cpp).
#define PIN_I2C_SCL   15    // ToF + FT6336 touch SHARED I2C SCL (IO15). Single master, two addresses — no pad-swapping.
#define PIN_BUTTON    21    // encoder shaft button (SW) — SHARES IO21 with the DHT11 (active-low; the DHT's pull-up holds it high). Was IO3, where it collided with the light ADC. Read by pollSideButton: short=select, long=back.
#define BTN_ACTIVE_LOW 1
#define PIN_BOOT_BTN   0    // on-board BOOT button -> dark/light theme toggle
#define PIN_HAPTIC    48    // motor driver base/gate — UNUSED (HAS_HAPTIC=0). NB: IO48 is an SD pin, not on any header.
#define PIN_MIC        2    // analog mic OUT -> IO2 (ADC1). WAS 4 = onboard I2S/speaker pin (bug)
#define PIN_DHT11     21    // DHT11 DATA -> IO21 (needs 4.7k–10k pull-up)  (HAS_TEMP)
#define PIN_LIGHT_ADC  3    // KY-018 AO -> IO3 (ADC1)               (HAS_LIGHT)
#define PIN_SPDT      40    // optional Work/Break toggle            (USE_SPDT_TOGGLE)
#define PIN_LED_RING  39    // WS2812B data                          (HAS_LED_RING)
#define PIN_BATTERY_ADC 6   // LiPo divider, S3 ADC1                 (HAS_BATTERY)

// ---- LED ring --------------------------------------------------------------
#define LED_COUNT 16

// ============================================================================
// Tunables (unchanged from the sibling firmware)
// ============================================================================
static const int           DUR_STEP_MIN       = 5;
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
static const unsigned long SETUP_TIMEOUT_MS   = 12000UL;
static const unsigned long SENSOR_WARMUP_MS   = 5000UL;
static const unsigned long SAMPLE_PERIOD_MS          = 60000UL;
static const unsigned long SAMPLE_PERIOD_COACHING_MS = 30000UL;
static const unsigned long SAMPLE_PERIOD_BREAK_MS    = 120000UL;
static const int           PRESENCE_NEAR_MM   = 700;
static const unsigned long PRESENCE_PAUSE_MS  = 30000UL;
static const unsigned long PRESENCE_END_MS    = 300000UL;
static const float         NOISE_FULL_SCALE_DEFAULT = 2000.0f;
// Maps mic level to an approximate real-world loudness: dB_SPL = 20*log10(acRms/32768) + offset.
// 116 pairs with reg 0x16 = +12dB ADC gain (the dynamic-range compromise: +18dB clipped loud sound,
// 0dB floored quiet rooms). Keeps mid/high readings aligned while lifting the quiet end off the floor.
// Per-unit sensitivity varies — refine once via serial 'c db <reference dB>' at a mid level (~50-60dB).
static const float         NOISE_DB_OFFSET_DEFAULT = 116.0f;
static const float         LIGHT_LUX_SCALE_DEFAULT  = 1000.0f;
static const float         LIGHT_VAR_SCALE_DEFAULT  = 2000.0f;
// KY-018 AO rises in DARKNESS (LDR in the lower divider leg), so the raw ADC goes
// UP when covered. Invert it so "lux" tracks brightness (bright = high, dark = low).
// Set 0 if your module is wired the other way (bright = high raw).
#define LIGHT_RAW_DARK_HIGH 1
static const float         TEMP_OFFSET_DEFAULT      = 0.0f;
static const unsigned long DHT_READ_INTERVAL_MS = 2000UL;
static const int           FLE_PRESENCE_CAP   = 5;
static const int           FLE_ADAPTIVE_BREAK = 75;
static const unsigned long COACHING_COOLDOWN_MS = 300000UL;
static const int           MAX_SAMPLES        = 120;
#define CHECKPOINT_TAIL_MAX 10
static const float         TEMP_MIN_VALID     = -20.0f;
static const float         TEMP_MAX_VALID     = 60.0f;
static const unsigned long TELEMETRY_PERIOD_MS = 60000UL;
// Min spacing between transition-triggered telemetry POSTs. A session fires a POST on every pause/resume/
// skip; coalescing rapid taps to one POST per this window cuts the back-to-back sockets that widen the
// lwip pbuf-double-free race. The 60s heartbeat (TELEMETRY_PERIOD_MS) is unaffected.
static const unsigned long TELEMETRY_MIN_GAP_MS = 3000UL;
static const unsigned long SESSION_CLOCK_MS    = 10UL;
static const unsigned long TOF_POLL_MS         = 500UL;   // ToF ranging period (shares the bus with touch; modest rate)
static const unsigned long WIFI_STATUS_CACHE_MS = 1000UL;

// ============================================================================
// Connectivity (ENABLE_WIFI / ENABLE_CLOUD)
// ============================================================================
#define CLOUD_USE_TLS 0
#define NTP_SERVER "pool.ntp.org"
#define WIFI_AP_SSID "MindBox-Setup"
// Cap Wi-Fi TX power to soften the association current spike that browns out the
// board on a marginal USB supply (lower = less peak draw). Used in Cloud::begin().
#define WIFI_TX_POWER WIFI_POWER_8_5dBm
// Wi-Fi modem power-save. 0 = radio always ON (WIFI_PS_NONE) — keeps the link solid so periodic HTTP
// doesn't stall and trip the task watchdog (the "reboots every few minutes while connected" bug). 1 =
// WIFI_PS_MIN_MODEM (lower average current). Use 1 ONLY if disabling it browns out the board on a weak
// 5V/USB supply (on-screen reset flips to "brownout"); the durable fix for that is a stronger supply.
#define WIFI_MODEM_SLEEP 0
#define WIFI_SCAN_MAX 16                                   // on-device scan list cap
static const unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000UL; // on-device join wait
static const unsigned long PORTAL_TIMEOUT_MS = 300000UL;
static const unsigned long CONFIG_FETCH_MS = 60000UL;
static const unsigned long CONFIG_FETCH_PAIRING_MS = 3000UL;
static const unsigned long CONFIG_FETCH_UNPAIRED_MS = 5000UL;
static const unsigned long WIFI_RETRY_MS   = 15000UL;
static const int           HTTP_TIMEOUT_MS = 3000;
static const int           HTTP_CONNECT_TIMEOUT_MS = 1500;
static const unsigned long NET_FAIL_BACKOFF_MS = 30000UL;
static const unsigned long NET_TASK_PERIOD_MS  = 200UL;
static const unsigned long SERVER_TODAY_TTL_MS = 180000UL;
static const unsigned long SIGN_OUT_GUARD_MS   = 90000UL;

// ---- upload queue (LittleFS Part B) ----------------------------------------
static const int           UPLOAD_QUEUE_MAX     = 12;
static const unsigned long UPLOAD_RETRY_MIN_MS  = 5000UL;
static const unsigned long UPLOAD_RETRY_MAX_MS  = 300000UL;

// ---- reliability -----------------------------------------------------------
// Disable the ESP32-S3 brownout detector at boot. On a marginal supply (e.g. a
// laptop USB port) the Wi-Fi current spike sags the 5V rail below the brownout
// threshold and the chip resets in a loop. This stops the AUTO-RESET so the box
// stays up — it does NOT fix the dip; the real fix is a stronger 5V source.
// Set 0 to restore the protective reset (recommended once power is solid).
// REVERTED to 0: the detector is armed by ESP-IDF startup BEFORE setup() runs, so this
// app-level write can't stop a boot-stage brownout (the "E BOD" loop) — and masking it
// turns a clean reboot into a dead-dark hang. The real fix is a stronger 5V supply.
#define DISABLE_BROWNOUT_DETECTOR 0
// 30s (was 15s): the net task does blocking HTTPClient calls whose setConnectTimeout/setTimeout are NOT a
// hard bound on arduino-esp32 — a stalled/half-open socket can block ~18-20s. The WDT must out-wait that
// worst case so one unlucky request can't reboot the box. The loop task feeds the WDT every ~1ms, so the
// wider margin doesn't weaken its protection.
static const unsigned long WDT_TIMEOUT_MS = 30000UL;
static const unsigned long I2C_HEALTH_MS  = 2000UL;
static const uint16_t      I2C_TIMEOUT_MS = 50;

// ---- haptics ---------------------------------------------------------------
#define HAPTIC_USE_PWM  1   // PWM drive so motor strength is selectable (Low/Med/High)
static const uint32_t      HAPTIC_FREQ_HZ       = 150;
static const uint8_t       HAPTIC_DUTY          = 255;
static const uint8_t       HAPTIC_BURST_N       = 4;
static const uint16_t      HAPTIC_BURST_ON_MS   = 550;
static const uint16_t      HAPTIC_BURST_GAP_MS  = 140;
static const uint16_t      HAPTIC_MS_CLICK      = 100;
static const uint16_t      HAPTIC_MS_TAP        = 500;
static const uint16_t      HAPTIC_MS_ENABLE_TEST = 550;
static const uint16_t      HAPTIC_MS_PAUSE      = 220;
static const uint16_t      HAPTIC_MS_PAUSE_GAP  = 140;
static const uint16_t      HAPTIC_MS_RESUME     = 600;
static const uint16_t      HAPTIC_MS_COMPLETE   = 700;
static const uint16_t      HAPTIC_MS_COMPLETE_GAP = 200;
static const uint16_t      HAPTIC_MS_RESET      = 750;
static const uint16_t      HAPTIC_TEST_HOLD_MS  = 3000;

// ---- side tactile button timing --------------------------------------------
static const unsigned long BTN_DEBOUNCE_MS      = 50UL;
static const unsigned long BTN_SHORT_MIN_MS     = 30UL;
static const unsigned long BTN_LONG_MS          = 500UL;
