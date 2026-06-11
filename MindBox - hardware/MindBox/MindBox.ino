/* =============================================================================
   MindBox — firmware entry point (orchestrator only).
   Board: DOIT ESP32 DevKit V1 (esp32doit-devkit-v1) @ 115200 baud.

   This .ino is intentionally tiny: it wires the modules together and ticks them.
   ALL real logic lives in the component files (see ARCHITECTURE.md):

     config.h        pins, feature flags, tunables   (edit here, nowhere else)
     types.h         shared enums/structs            focus_load.h  FLE heuristic
     Display         OLED + screens                  LedRing       WS2812B (stub)
     Haptics         vibration patterns              Inputs        encoder/button
     Sensors         mic / ToF / temp / light / batt Storage       NVS persistence
     Cloud           Wi-Fi + ingest + config pull    Session       timing + samples
     StateMachine    the brain (state diagram)       Diagnostics   serial monitor
     Menu            pointer menus (home/settings)   

   To extend: implement a sensor's read function + flip its flag in config.h;
   nothing else changes. Monitor at runtime: open Serial @115200 and press 'm',
   or open Device -> Diagnostics in the pointer menu.
   ========================================================================== */
#include <Wire.h>
#include "config.h"
#include "Display.h"
#include "Haptics.h"
#include "LedRing.h"
#include "Inputs.h"
#include "Sensors.h"
#include "Storage.h"
#include "Cloud.h"
#include "Session.h"
#include "StateMachine.h"
#include "Diagnostics.h"

static uint32_t s_lastTele = 0;

void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000);

  Storage::begin();
  Display::init();
  Haptics::init();
  LedRing::init();
  Inputs::init();
  Sensors::init();
  Cloud::begin();
  StateMachine::init();

  Diagnostics::selfTest();   // prints the sensor-connection report
}

void loop() {
  Haptics::tick();           // advance any active vibration pattern
  Sensors::tick();           // sample mic + refresh presence
  Cloud::tick();             // (reserved) retries / config refresh
  StateMachine::tick();      // read inputs, run FSM, render
  Diagnostics::tick();       // serial monitor commands + stream

  // periodic telemetry heartbeat (no-op until ENABLE_CLOUD)
  if (millis() - s_lastTele > TELEMETRY_PERIOD_MS) {
    s_lastTele = millis();
    const char* ts = (StateMachine::state() == ST_RUNNING)
                       ? (StateMachine::mode() == MODE_WORK ? "work" : "break")
                       : "idle";
    int batt = Sensors::batteryPct();
    TelemetryModel t = { ts, batt < 0 ? 100 : batt, Cloud::wifiRssi() };
    Cloud::sendTelemetry(t, Sensors::healthJson());
  }

  delay(5);
}
