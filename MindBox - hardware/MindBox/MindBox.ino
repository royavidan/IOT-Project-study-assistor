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

static uint32_t s_lastTele = 0;

void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(400000);   // 400 kHz fast-mode: ~4x faster OLED redraw (was 100 kHz)

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
  Haptics::tick();           // advance any active vibration pattern
  Sensors::tick();           // sample mic + refresh presence
  Cloud::tick(StateMachine::state());      // Wi-Fi reconnect + upload queue drain
  StateMachine::tick();      // read inputs, run FSM, render
  Diagnostics::tick();       // serial monitor commands + stream

  // Telemetry heartbeat — skip during active sessions (HTTP blocks the main loop).
  SysState st = StateMachine::state();
  if (st != ST_RUNNING && st != ST_PAUSED &&
      millis() - s_lastTele > TELEMETRY_PERIOD_MS) {
    s_lastTele = millis();
    const char* ts = "idle";
    int batt = Sensors::batteryPct();
    TelemetryModel t = { ts, batt < 0 ? 100 : batt, Cloud::wifiRssi() };
    Cloud::sendTelemetry(t, Sensors::healthJson());
  }

  delay(5);
}
