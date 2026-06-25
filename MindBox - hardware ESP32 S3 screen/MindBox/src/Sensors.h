#pragma once
// ============================================================================
// Sensors — environment + presence inputs behind one interface.
//   Active:  microphone (noise), VL53L1X ToF (presence).
//   Active:  DHT11 (temp), KY-018 photoresistor (light lux + variance).
//   Stubbed: battery — return false/absent until present.
// ============================================================================
#include "types.h"

namespace Sensors {
  void init();
  void reloadCalibration();    // refresh NVS scale factors (after serial 'c' adjust)
  void tick();                 // sample mic (~1Hz) + refresh presence distance

  float noise();               // normalized 0..1 (rolling, updated ~1Hz)
  float noiseDb();             // approx loudness in dB SPL (calibrated; see Storage::noiseDbOffset)
  float noiseProbe(uint16_t windowMs = 50);  // immediate blocking measure (diagnostics)
  int   presenceMm();          // last ToF distance, -1 if unknown
  bool  present();             // within PRESENCE_NEAR_MM (true if no ToF)
  unsigned long absentForMs(); // how long continuously absent (0 if present)

  bool  readTemp(float& c);            // false if no sensor
  bool  readLight(float& lux, float& variance);  // false if no sensor
  int   batteryPct();          // -1 if unknown

  bool  faulted();             // a hard sensor fault (Story 15 ERROR state)
  void  clearFault();          // reset fault + attempt I2C/ToF recovery (ERROR exit)
  SensorHealth health();
  String healthJson();         // for /ingest/telemetry sensor_health

  int   i2cScan(uint8_t* out, int maxOut);   // diagnostics helper
}
