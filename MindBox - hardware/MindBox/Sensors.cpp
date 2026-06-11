#include "Sensors.h"
#include "Storage.h"
#include "config.h"
#include <Wire.h>

#if HAS_TEMP
#include <DHT.h>
static DHT s_dht(PIN_DHT11, DHT11);
static float    s_tempC = NAN;
static bool     s_tempOk = false;
static uint32_t s_lastDhtRead = 0;
#endif

#if HAS_LIGHT
static float    s_lux = 0;
static float    s_lightVar = 0;
static int      s_lMin = 4095, s_lMax = 0;
static uint32_t s_lWin = 0;
#endif

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

static float s_noiseScale = NOISE_FULL_SCALE_DEFAULT;
static float s_lightLuxScale = LIGHT_LUX_SCALE_DEFAULT;
static float s_lightVarScale = LIGHT_VAR_SCALE_DEFAULT;

#if HAS_TEMP
static bool refreshDht(bool force) {
  uint32_t now = millis();
  if (!force && now - s_lastDhtRead < DHT_READ_INTERVAL_MS) return s_tempOk;
  s_lastDhtRead = now;
  float t = s_dht.readTemperature();
  if (isnan(t)) {
    s_tempOk = false;
    return false;
  }
  t += Storage::tempOffsetC();
  if (t < TEMP_MIN_VALID || t > TEMP_MAX_VALID) {
    s_tempOk = false;
    return false;
  }
  s_tempC = t;
  s_tempOk = true;
  return true;
}
#endif

#if HAS_LIGHT
static float clamp01f(float v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

static void refreshLightWindow() {
  int raw = analogRead(PIN_LIGHT_ADC);
  if (raw < s_lMin) s_lMin = raw;
  if (raw > s_lMax) s_lMax = raw;
  if (millis() - s_lWin >= 1000) {
    int mid = (s_lMin + s_lMax) / 2;
    s_lux = (float)mid / 4095.0f * s_lightLuxScale;
    float pp = (float)(s_lMax - s_lMin);
    s_lightVar = clamp01f(pp / s_lightVarScale);
    s_lMin = 4095;
    s_lMax = 0;
    s_lWin = millis();
  }
}
#endif

namespace Sensors {

void reloadCalibration() {
  s_noiseScale = Storage::noiseFullScale();
  s_lightLuxScale = Storage::lightLuxScale();
  s_lightVarScale = Storage::lightVarScale();
}

void init() {
  analogReadResolution(12);
  reloadCalibration();
  s_nWin = millis();
#if HAS_LIGHT
  s_lWin = millis();
#endif
#if HAS_TEMP
  s_dht.begin();
  delay(100);
  refreshDht(true);
#endif
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
    float pp = (s_nMax - s_nMin) / s_noiseScale;
    s_noise = pp < 0 ? 0 : (pp > 1 ? 1 : pp);
    s_nMin = 4095; s_nMax = 0; s_nWin = millis();
  }

#if HAS_LIGHT
  refreshLightWindow();
#endif

#if HAS_TEMP
  if (millis() >= SENSOR_WARMUP_MS)
    refreshDht(false);
#endif

#if HAS_PRESENCE
  static uint32_t s_lastTofPoll = 0;
  if (s_tofPresent && millis() - s_lastTofPoll >= TOF_POLL_MS) {
    s_lastTofPoll = millis();
    if (vl53.dataReady()) {
      int16_t d = vl53.distance();
      vl53.clearInterrupt();
      if (d > 0) s_lastDist = d;
    }
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
  float pp = (mx - mn) / s_noiseScale;
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
  if (millis() < SENSOR_WARMUP_MS) {
    c = NAN;
    return false;
  }
  if (!refreshDht(true)) {
    c = NAN;
    return false;
  }
  c = s_tempC;
  return true;
#else
  c = NAN; return false;
#endif
}

bool readLight(float& lux, float& variance) {
#if HAS_LIGHT
  lux = s_lux;
  variance = s_lightVar;
  return true;
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
#if HAS_LIGHT
  h.lightPresent   = true;
#else
  h.lightPresent   = false;
#endif
#if HAS_TEMP
  h.tempPresent    = s_tempOk;
#else
  h.tempPresent    = false;
#endif
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
  s += "\"light\":\"";
#if HAS_LIGHT
  s += "ok";
#else
  s += "absent";
#endif
  s += "\",";
  s += "\"temp\":\"";
#if HAS_TEMP
  s += s_tempOk ? "ok" : "invalid";
#else
  s += "absent";
#endif
  s += "\"}";
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
