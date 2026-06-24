#include "Sensors.h"
#include "Storage.h"
#include "config.h"
#include "Audio.h"
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
static bool     s_noiseValid = true;
static int      s_micDead = 0;
static uint32_t s_lastBusCheck = 0;
static int      s_busFailStreak = 0;

static float s_noiseScale = NOISE_FULL_SCALE_DEFAULT;
static float s_lightLuxScale = LIGHT_LUX_SCALE_DEFAULT;
static float s_lightVarScale = LIGHT_VAR_SCALE_DEFAULT;

#if HAS_TEMP
static bool refreshDht(bool force) {
  uint32_t now = millis();
  if (!force && now - s_lastDhtRead < DHT_READ_INTERVAL_MS) return s_tempOk;
  s_lastDhtRead = now;
  float t = s_dht.readTemperature();
  if (isnan(t)) {                       // one forced retry rides out a transient bad read
    delay(60);
    t = s_dht.readTemperature(false, true);
  }
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
#if LIGHT_RAW_DARK_HIGH
    mid = 4095 - mid;            // KY-018 reads high in the dark -> invert to brightness
#endif
    s_lux = (float)mid / 4095.0f * s_lightLuxScale;
    float pp = (float)(s_lMax - s_lMin);
    s_lightVar = clamp01f(pp / s_lightVarScale);
    s_lMin = 4095;
    s_lMax = 0;
    s_lWin = millis();
  }
}
#endif

// I2C bus recovery: clock out a slave that's holding SDA low, issue STOP, then
// re-init the bus (+ ToF). Returns true if SDA was released. Wire.setTimeOut()
// keeps individual transactions from hanging; this unwedges a stuck bus.
static bool i2cRecover() {
  Wire.end();
  pinMode(PIN_I2C_SCL, OUTPUT);
  pinMode(PIN_I2C_SDA, INPUT_PULLUP);
  for (int i = 0; i < 9 && digitalRead(PIN_I2C_SDA) == LOW; i++) {
    digitalWrite(PIN_I2C_SCL, LOW);  delayMicroseconds(5);
    digitalWrite(PIN_I2C_SCL, HIGH); delayMicroseconds(5);
  }
  bool freed = (digitalRead(PIN_I2C_SDA) == HIGH);
  pinMode(PIN_I2C_SDA, OUTPUT);                 // STOP: SDA low->high while SCL high
  digitalWrite(PIN_I2C_SDA, LOW);  delayMicroseconds(5);
  digitalWrite(PIN_I2C_SCL, HIGH); delayMicroseconds(5);
  digitalWrite(PIN_I2C_SDA, HIGH); delayMicroseconds(5);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(400000);
  Wire.setTimeOut(I2C_TIMEOUT_MS);
#if HAS_PRESENCE
  if (vl53.begin(0x29, &Wire)) {
    vl53.VL53L1X_SetDistanceMode(2);
    vl53.setTimingBudget(50);
    vl53.startRanging();
    s_tofPresent = true;
  } else {
    s_tofPresent = false;                        // ToF dead (bus fine) -> degrade
  }
#endif
  return freed;
}

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
#if HAS_I2S_MIC
  // microphone: the core-0 I2S audio task publishes a rolling RMS (0..1); mirror it.
  s_noise = Audio::micLevel();
  s_noiseValid = Audio::micReady();
#else
  // analog microphone: rolling ~1Hz peak-to-peak, normalized
  int v = analogRead(PIN_MIC);
  if (v < s_nMin) s_nMin = v;
  if (v > s_nMax) s_nMax = v;
  if (millis() - s_nWin >= 1000) {
    int rawpp = s_nMax - s_nMin;
    // Story 18: a dead/disconnected mic rails at an extreme with no variation.
    bool dead = (rawpp < 3) && (s_nMax < 10 || s_nMin > 4085);
    s_micDead = dead ? s_micDead + 1 : 0;
    s_noiseValid = (s_micDead < 5);             // ~5s of dead readings -> invalid
    float ppn = s_noiseValid ? (rawpp / s_noiseScale) : 0;
    s_noise = ppn < 0 ? 0 : (ppn > 1 ? 1 : ppn);
    s_nMin = 4095; s_nMax = 0; s_nWin = millis();
  }
#endif

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
      if (d > 0 && d < 4000) s_lastDist = d;   // ignore implausible readings (Story 18)
    }
  }
  // I2C watchdog: the ToF is our bus canary. If it stops ACKing, recover the bus.
  // SDA still held after recovery = wedged bus (also kills the OLED) -> critical
  // fault. A dead ToF with a healthy bus only degrades (presence disabled).
  if (s_tofPresent && millis() - s_lastBusCheck >= I2C_HEALTH_MS) {
    s_lastBusCheck = millis();
    Wire.beginTransmission(0x29);
    if (Wire.endTransmission() == 0) {
      s_busFailStreak = 0;
    } else if (++s_busFailStreak >= 2) {
      s_busFailStreak = 0;
      Serial.println("[i2c] ToF not responding — recovering bus");
      bool freed = i2cRecover();
      if (!freed) {
        s_fault = true;
        Serial.println("[i2c] bus still held — sensor fault");
      } else if (!s_tofPresent) {
        Serial.println("[i2c] bus ok but ToF dead — presence disabled");
      }
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
#if HAS_I2S_MIC
  (void)windowMs;
  return Audio::micLevel();              // I2S task already maintains the rolling level
#else
  uint32_t start = millis();
  int mn = 4095, mx = 0;
  while (millis() - start < windowMs) {
    int v = analogRead(PIN_MIC);
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  float pp = (mx - mn) / s_noiseScale;
  return pp < 0 ? 0 : (pp > 1 ? 1 : pp);
#endif
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

bool faulted() { return s_fault; }

void clearFault() {
  s_fault = false;
  s_busFailStreak = 0;
  i2cRecover();                       // try to bring the bus + ToF back on ERROR exit
}

SensorHealth health() {
  SensorHealth h;
  h.micOk          = s_noiseValid;
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
  s += "\"mic\":\""; s += s_noiseValid ? "ok" : "invalid"; s += "\",";
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
