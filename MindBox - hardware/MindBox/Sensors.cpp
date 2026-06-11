#include "Sensors.h"
#include "config.h"
#include <Wire.h>

#if HAS_PRESENCE
#include <Adafruit_VL53L1X.h>
static Adafruit_VL53L1X vl53(-1, -1);
static bool s_tofPresent = false;
#endif

static float    s_noise = 0;
static int      s_nMin = 4095, s_nMax = 0;
static uint32_t s_nWin = 0;
static int      s_lastDist = -1;
static bool     s_wasPresent = true;
static uint32_t s_absentAt = 0;
static bool     s_fault = false;

namespace Sensors {

void init() {
  analogReadResolution(12);
  s_nWin = millis();
#if HAS_PRESENCE
  if (vl53.begin(0x29, &Wire)) {
    vl53.VL53L1X_SetDistanceMode(2);   // long range
    vl53.setTimingBudget(50);
    vl53.startRanging();
    s_tofPresent = true;
  } else {
    s_tofPresent = false;              // degrade gracefully (no auto-pause)
  }
#endif
}

void tick() {
  // microphone: rolling ~1Hz peak-to-peak, normalized
  int v = analogRead(PIN_MIC);
  if (v < s_nMin) s_nMin = v;
  if (v > s_nMax) s_nMax = v;
  if (millis() - s_nWin >= 1000) {
    float pp = (s_nMax - s_nMin) / NOISE_FULL_SCALE;
    s_noise = pp < 0 ? 0 : (pp > 1 ? 1 : pp);
    s_nMin = 4095; s_nMax = 0; s_nWin = millis();
  }
#if HAS_PRESENCE
  if (s_tofPresent && vl53.dataReady()) {
    int16_t d = vl53.distance();
    vl53.clearInterrupt();
    if (d > 0) s_lastDist = d;
  }
#endif
  // track presence transitions for the auto-pause timer
  bool p = present();
  if (!p && s_wasPresent) s_absentAt = millis();
  s_wasPresent = p;
}

float noise()      { return s_noise; }

// Immediate peak-to-peak probe (doesn't disturb the rolling window). Used by the
// self-test/diagnostics so a working mic shows a real value right away.
float noiseProbe(uint16_t windowMs) {
  uint32_t start = millis();
  int mn = 4095, mx = 0;
  while (millis() - start < windowMs) {
    int v = analogRead(PIN_MIC);
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  float pp = (mx - mn) / NOISE_FULL_SCALE;
  return pp < 0 ? 0 : (pp > 1 ? 1 : pp);
}

int   presenceMm() { return s_lastDist; }

bool present() {
#if HAS_PRESENCE
  if (!s_tofPresent) return true;             // can't tell -> assume present
  return s_lastDist > 0 && s_lastDist < PRESENCE_NEAR_MM;
#else
  return true;
#endif
}

unsigned long absentForMs() { return present() ? 0 : (millis() - s_absentAt); }

bool readTemp(float& c) {
#if HAS_TEMP
  // TODO: read sensor, then Story-18 clamp:
  //   if (c < TEMP_MIN_VALID || c > TEMP_MAX_VALID) return false;
  c = NAN; return false;
#else
  c = NAN; return false;
#endif
}

bool readLight(float& lux, float& variance) {
#if HAS_LIGHT
  lux = 0; variance = 0; return false;        // TODO: e.g. BH1750
#else
  lux = 0; variance = 0; return false;
#endif
}

int batteryPct() {
#if HAS_BATTERY
  return 100;                                  // TODO: ADC divider -> %
#else
  return -1;
#endif
}

bool faulted() { return s_fault; }   // reserved for runtime fault detection

SensorHealth health() {
  SensorHealth h;
  h.micOk          = true;
#if HAS_PRESENCE
  h.tofPresent     = s_tofPresent;
  h.tofOk          = s_tofPresent && !s_fault;
#else
  h.tofPresent     = false;
  h.tofOk          = false;
#endif
  h.lightPresent   = HAS_LIGHT;
  h.tempPresent    = HAS_TEMP;
  h.batteryPresent = HAS_BATTERY;
  return h;
}

String healthJson() {
  String s = "{";
  s += "\"mic\":\"ok\",";
  s += "\"tof\":\"";
#if HAS_PRESENCE
  s += s_tofPresent ? "ok" : "invalid";
#else
  s += "absent";
#endif
  s += "\",";
  s += "\"light\":\""; s += (HAS_LIGHT ? "ok" : "absent"); s += "\",";
  s += "\"temp\":\"";  s += (HAS_TEMP  ? "ok" : "absent"); s += "\"}";
  return s;
}

int i2cScan(uint8_t* out, int maxOut) {
  int n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { if (n < maxOut) out[n] = a; n++; }
  }
  return n;
}

} // namespace Sensors
