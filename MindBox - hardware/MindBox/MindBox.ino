/* =============================================================================
   MindBox — firmware entry point (orchestrator only).
   Board: DOIT ESP32 DevKit V1 (esp32doit-devkit-v1) @ 115200 baud.

   This .ino is intentionally tiny: it wires the modules together and ticks them.
   ALL real logic lives in the component files (see ARCHITECTURE.md):

     config.h        pins, feature flags, tunables   (edit here, nowhere else)
     types.h         shared enums/structs            focus_load.h  FLE heuristic
     Display         OLED + screens                  LedRing       WS2812B (stub)
     Haptics         vibration patterns              Inputs        encoder/button
     Sensors         mic / ToF / DHT11 / KY-018 / batt Storage       NVS persistence
     UploadQueue     LittleFS session backlog        Cloud         Wi-Fi + ingest + config pull
     Session         timing + samples
     StateMachine    the brain (state diagram)       Diagnostics   serial monitor
     Menu            pointer menus (home/settings)   

   To extend: implement a sensor's read function + flip its flag in config.h;
   nothing else changes. Monitor at runtime: open Serial @115200 and press 'm',
   or open Device -> Diagnostics in the pointer menu.
   ========================================================================== */
#include <Wire.h>
#include "esp_task_wdt.h"
#include "config.h"
#include "Display.h"
#include "Haptics.h"
#include "LedRing.h"
#include "Inputs.h"
#include "Sensors.h"
#include "Storage.h"
#include "Cloud.h"
#include "UploadQueue.h"
#include "Session.h"
#include "StateMachine.h"
#include "Diagnostics.h"

void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(400000);            // 400 kHz fast-mode: ~4x faster OLED redraw
  Wire.setTimeOut(I2C_TIMEOUT_MS);  // never block forever on a wedged I2C bus

  // Task watchdog: reboot if the main loop stalls (e.g. a hung peripheral).
  esp_task_wdt_config_t wdtCfg = {};
  wdtCfg.timeout_ms     = WDT_TIMEOUT_MS;
  wdtCfg.idle_core_mask = 0;        // watch the loop task, not the idle tasks
  wdtCfg.trigger_panic  = true;
  esp_task_wdt_reconfigure(&wdtCfg);
  esp_task_wdt_add(NULL);

  Storage::begin();
  Display::init();
  Haptics::init();
  LedRing::init();
  Inputs::init();
  Sensors::init();
  UploadQueue::begin();
  Cloud::begin();
  StateMachine::init();

  Diagnostics::selfTest();   // prints the sensor-connection report
}

void loop() {
  esp_task_wdt_reset();      // feed the watchdog
  Haptics::tick();           // advance any active vibration pattern
  Sensors::tick();           // sample mic + refresh presence
  StateMachine::tick();      // inputs, FSM, render + publish live state to the net task
  Diagnostics::tick();       // serial monitor commands + stream
  delay(5);                  // Wi-Fi/HTTP/telemetry/upload all run on the core-0 net task
}
