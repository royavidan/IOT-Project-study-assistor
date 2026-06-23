#define LGFX_USE_V1
#include <Wire.h>
#include "esp_task_wdt.h"

#include "src/config.h"
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

void setup() {
  Serial.begin(115200);
  delay(200);

#if HAS_PRESENCE
  // Aux I2C (ToF) only — the FT6336 touch owns its own I2C port/pins (config.h).
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(400000);
  Wire.setTimeOut(I2C_TIMEOUT_MS);
#endif

  pinMode(PIN_TFT_BL, OUTPUT);
  digitalWrite(PIN_TFT_BL, HIGH);     // backlight on
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);

  Storage::begin();
  Display::init();                    // brings up Panel + sprite
  Theme::setDark(Storage::darkTheme());   // restore the last-chosen theme
  Haptics::init();
  LedRing::init();
  Inputs::init();                     // may run one-time touch calibration
  Sensors::init();
  UploadQueue::begin();
  Cloud::begin();
  StateMachine::init();

  // Apply persisted display/haptic preferences now that config is loaded.
  Panel::setBrightness(StateMachine::config().brightnessPct);
  Haptics::setLevel(StateMachine::config().hapticLevel);

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
  delay(5);
}
