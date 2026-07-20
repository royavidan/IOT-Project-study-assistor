#define LGFX_USE_V1
#include <Wire.h>
#include "esp_task_wdt.h"
#include "esp_heap_caps.h"

#include "src/config.h"
#if DISABLE_BROWNOUT_DETECTOR
#include "soc/rtc_cntl_reg.h"   // RTC_CNTL_BROWN_OUT_REG
#include "soc/soc.h"            // WRITE_PERI_REG
#endif
#include "src/Panel.h"
#include "src/Display.h"
#include "src/Theme.h"
#include "src/Inputs.h"
#include "src/Sensors.h"
#include "src/Storage.h"
#include "src/Cloud.h"
#include "src/UploadQueue.h"
#include "src/Session.h"
#include "src/StateMachine.h"
#include "src/Diagnostics.h"
#include "src/Haptics.h"
#include "src/Sound.h"
#include "src/Audio.h"
#include "src/LedRing.h"
#if USE_TOUCH
#include "src/Touch.h"
#endif

// ============================================================================
// MindBox — ESP32-S3 (Hosyond 2.8" ILI9341) firmware entry point.
//
// Orchestrator only: wire the modules and tick them. All logic lives in src/
// (see CLAUDE.md). The box boots to a touch-navigable home menu and runs the
// full session lifecycle; peripherals come up behind their HAS_* flags.
//
// Input: touchscreen (USE_TOUCH) and/or KY-040 encoder (HAS_ENCODER).
// BOOT (GPIO0): tap = dark/light theme; hold = recalibrate touch.
// Serial @115200: m/c/d/h, w.
// ============================================================================

// On-screen + serial boot breadcrumb (call only AFTER Display::init()). If boot stalls,
// the screen freezes on the last step shown; if it reboot-loops, the text keeps resetting
// to the first step. Turns the opaque white screen into a visible "where did it die".
static void bootMsg(const char* step) {
  Serial.printf("[boot] %s\n", step);
  Display::clear();
  Display::center("MindBox", 8, 2);
  Display::center(step, 40, 1);
  Display::show();
}

// Heap OOM tripwire: the instant ANY allocation fails, print the size + remaining internal heap, so an
// out-of-memory panic (the net task does String-heavy HTTP on a tight internal heap) names itself in
// Serial instead of just rebooting as a generic "panic/crash". Costs nothing until an alloc fails.
static void onAllocFail(size_t size, uint32_t caps, const char* fn) {
  // Use a stack buffer + Serial.write, NOT Serial.printf — printf heap-allocates a temp buffer, which
  // would itself fail in this exact OOM context. snprintf into a fixed buffer allocates nothing.
  char buf[128];
  int n = snprintf(buf, sizeof(buf), "[heap] ALLOC FAILED %u bytes caps=0x%x free_internal=%u in %s\n",
                   (unsigned)size, (unsigned)caps,
                   (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL), fn ? fn : "?");
  if (n > 0) Serial.write((const uint8_t*)buf, n < (int)sizeof(buf) ? n : (int)sizeof(buf) - 1);
}

void setup() {
#if DISABLE_BROWNOUT_DETECTOR
  // FIRST thing, before the radio/peripherals draw current: stop the brownout
  // detector from auto-rebooting on a transient Wi-Fi sag (laptop-USB supply).
  // This masks the reset; it does NOT fix the dip — use a stronger 5V source.
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
#endif
  Serial.begin(115200);
  delay(200);
  heap_caps_register_failed_alloc_callback(onAllocFail);   // OOM tripwire (see above)

  // ToF I2C (Wire/port 0) is brought up later in Sensors::init() — AFTER Display::init() so the
  // FT6336 touch (port 1) claims the shared IO16/15 pads first; the ToF then re-claims per read.

  pinMode(PIN_TFT_BL, OUTPUT);
  digitalWrite(PIN_TFT_BL, HIGH);     // backlight on
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);

  Serial.println("[boot] storage");
  Storage::begin();
  // Audio BEFORE Display: Audio::begin() configures the ES8311 codec over software-I2C on
  // the touch pins (IO16/IO15), then releases them. That MUST happen before LovyanGFX claims
  // those pins for the FT6336 touch in Display::init(). Doing it after (as the on-screen
  // breadcrumb order tempts) leaves the touch bus wedged and touch comes up dead. This was
  // latent while the mic was a no-op stub; enabling HAS_I2S_MIC made Audio::begin() real.
  Serial.println("[boot] audio");
  Audio::begin();
  // Display next so the panel is up before anything else risky. Every step after this paints
  // an on-screen breadcrumb, so a stall freezes the screen on the step that hung (and a
  // reboot loop shows the text restarting from the top) — no serial cable needed.
  Serial.println("[boot] display");
  Display::init();                    // brings up Panel + sprite
  Theme::setDark(Storage::darkTheme());   // restore the last-chosen theme
  Theme::setAccentPreset(Storage::themeAccent());   // + the site-chosen accent preset
  bootMsg("display ok");
  // Surface WHY we last reset (brownout / panic / task-wdt) on-screen — no serial cable
  // needed. If the box reboot-loops, this is the word to read to know power vs. crash.
  { char line[40];
    snprintf(line, sizeof(line), "reset: %s", Diagnostics::resetReason());
    Display::clear();
    Display::center("MindBox", 8, 2);
    Display::center(line, 40, 1);
    Display::show();
    delay(1200); }
  bootMsg("audio ok");                 // Audio::begin() already ran pre-Display (for the touch bus)
  bootMsg("haptics");  Haptics::init(); Sound::init(); LedRing::init();
  bootMsg("inputs");   Inputs::init();   // may run one-time touch calibration
  bootMsg("sensors");  Sensors::init();
  bootMsg("queue");    UploadQueue::begin();
  bootMsg("wifi");     Cloud::begin();
  bootMsg("menu");     StateMachine::init();

  // Apply persisted display/haptic/sound preferences now that config is loaded.
  Panel::setBrightness(StateMachine::config().brightnessPct);
  Haptics::setLevel(StateMachine::config().hapticLevel);
  Sound::setEnabled(StateMachine::config().soundEnabled);
  Sound::setVolume(StateMachine::config().soundLevel);
  Sound::test();   // brief boot beep — confirms the speaker/amp are wired (ignores the Sound on/off setting)

  Diagnostics::selfTest();

  // Arm the task watchdog AFTER init (touch calibration can block on user taps).
  esp_task_wdt_config_t wdtCfg = {};
  wdtCfg.timeout_ms     = WDT_TIMEOUT_MS;
  wdtCfg.idle_core_mask = 0;
  wdtCfg.trigger_panic  = true;
  esp_task_wdt_reconfigure(&wdtCfg);
  esp_task_wdt_add(NULL);
}

// BOOT button (GPIO0): tap toggles theme; hold (>1.5s) recalibrates touch.
static void pollBootButton() {
  static bool          prev = true;
  static unsigned long downAt = 0;
  static bool          longDone = false;
  bool cur = digitalRead(PIN_BOOT_BTN);

  if (prev && !cur) { downAt = millis(); longDone = false; }      // pressed
  if (!cur && !longDone && millis() - downAt > 1500) {            // long hold
#if USE_TOUCH
    esp_task_wdt_delete(NULL);       // calibration blocks on user taps
    Touch::calibrate();
    esp_task_wdt_add(NULL);
#endif
    longDone = true;
  }
  if (!prev && cur && !longDone) {                                // short release
    Theme::toggle();
    Storage::setDarkTheme(Theme::isDark());                       // remember across reboots
  }
  prev = cur;
}

void loop() {
  esp_task_wdt_reset();
  pollBootButton();
  Haptics::tick();
  Sensors::tick();
  StateMachine::tick();   // inputs -> FSM -> render -> publish to net task
  Diagnostics::tick();
  delay(1);               // poll/redraw promptly (snappy encoder/touch); still yields to FreeRTOS
}
