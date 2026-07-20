#include "Sensors.h"
#include "Storage.h"
#include "config.h"
#include "Audio.h"
#include <Wire.h>
#include <math.h>
// The FT6336 touch (Touch.cpp) and the VL53L1X ToF (here) share ONE I2C master on Arduino Wire (IO16/15):
// touch and ToF reads both run on the core-1 loop, so they simply serialize on the bus — no second master,
// no pad-swapping, no contention. (This replaced the old two-master setup that killed touch.)

#if HAS_TEMP
#include <DHT.h>
static DHT s_dht(PIN_DHT11, DHT11);
static float    s_tempC = NAN;
static bool     s_tempOk = false;
static float    s_humid = NAN;
static bool     s_humidOk = false;
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
  // IO21 is shared with the encoder SW. If it's held low (button pressed), a DHT read would fail and
  // the held line confuses the sensor — skip and keep the last value (retries once the knob is released).
  if (digitalRead(PIN_DHT11) == LOW) return s_tempOk;
  s_lastDhtRead = now;
  float t = s_dht.readTemperature();
  if (isnan(t) && force) {              // retry ONLY on the on-demand readTemp() path; the 2s
    delay(60);                          // background tick must not block the loop (encoder hitch)
    t = s_dht.readTemperature(false, true);
  }
  if (isnan(t)) {
    if (!force) return s_tempOk;        // background tick: keep last good value, don't flap to invalid
    s_tempOk = false;                   // on-demand read genuinely failed
    return false;
  }
  // Humidity rides the same DHT transaction (the lib caches one frame) — no
  // extra pin traffic. Keep the last good value if only the humidity is off.
  float h = s_dht.readHumidity();
  if (!isnan(h) && h >= 0.0f && h <= 100.0f) { s_humid = h; s_humidOk = true; }
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
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);   // ONE shared I2C master. Touch::begin() already started this Wire
  Wire.setClock(400000);                  // (USE_TOUCH); re-begin is harmless. The ToF (0x29) and FT6336 touch
  Wire.setTimeOut(I2C_TIMEOUT_MS);        // (0x38) are two addresses on this single bus — no pad-swapping.
  if (vl53.begin(0x29, &Wire)) {
    vl53.VL53L1X_SetDistanceMode(2);   // long range
    vl53.setTimingBudget(50);
    vl53.startRanging();
    s_tofPresent = true;
    Serial.println("[tof] VL53L1X init OK @0x29 - ranging");
  } else {
    s_tofPresent = false;              // degrade gracefully (no auto-pause)
    // Make the failure visible: probe 0x29 so the log says WHY. No ACK => wiring / XSHUT held low /
    // wrong sensor (a VL53L0X will NOT init with this VL53L1X library). ACK => sensor's there, init failed.
    Wire.beginTransmission(0x29);
    bool ack = (Wire.endTransmission() == 0);
    Serial.printf("[tof] VL53L1X init FAILED (0x29 %s) - presence disabled\n",
                  ack ? "ACKs: library/init issue" : "no ACK: check wiring/XSHUT/sensor model");
  }
#endif
}

void tick() {
#if HAS_I2S_MIC
  // microphone: the core-0 I2S audio task publishes a rolling RMS (0..1); mirror it.
  s_noise = Audio::micLevel();
  s_noiseValid = Audio::micReady();
#elif HAS_MIC
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
#else
  // No microphone present (both mic flags off). Don't sample a floating ADC pin —
  // IO2 is unconnected on this board and would report phantom ~70-80% noise.
  s_noise = 0; s_noiseValid = false;
#endif

#if HAS_LIGHT
  refreshLightWindow();
#endif

#if HAS_TEMP
  if (millis() >= SENSOR_WARMUP_MS)
    refreshDht(false);
#endif

#if HAS_PRESENCE
  // ToF ranging on the shared single bus — a plain Wire read; it just serializes with the touch reads on the
  // core-1 loop (no pad-swapping needed now that touch is on the same master).
  static uint32_t s_lastTofPoll = 0;
  if (s_tofPresent && millis() - s_lastTofPoll >= TOF_POLL_MS) {
    s_lastTofPoll = millis();
    bool rdy = vl53.dataReady();
    int16_t d = rdy ? vl53.distance() : -1;
    if (rdy) vl53.clearInterrupt();
    if (rdy && d > 0 && d < 4000) s_lastDist = d;   // ignore implausible readings (Story 18)
#if TOF_DEBUG
    // Pinpoints a STUCK reading: ready=0 => not re-arming (clearInterrupt/dataReady failing on the shared bus);
    // ready=1 + status!=0 => sensor returns a value but the range is invalid; ready=1 + raw constant => optics
    // (pointed at a fixed surface); raw outside (0,4000) => the clamp is rejecting it. status 0 = valid range.
    Serial.printf("[tof] ready=%d raw=%d status=%u kept=%d\n", rdy, d, (unsigned)vl53.vl_status, s_lastDist);
#endif
  }
  // I2C watchdog: the ToF is our bus canary. If it stops ACKing, recover the bus.
  // SDA still held after recovery = wedged bus (also kills the screen) -> critical
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

// Approximate loudness in dB SPL. dBFS = 20*log10(acRms / full-scale) is exact from the digital
// signal; adding the NVS calibration offset maps it to real-world dB (rough — these MEMS mics
// aren't lab instruments, and very loud sound clips). Calibrate once via serial 'c db <ref>'.
float noiseDb() {
#if HAS_I2S_MIC
  float rms = Audio::micRms();              // raw AC-RMS counts (DC removed), unclamped
#else
  float rms = s_noise * s_noiseScale;       // best-effort from the normalized level (analog path)
#endif
  if (rms < 1.0f) rms = 1.0f;               // floor: avoid log(0) on dead silence
  float dbfs = 20.0f * log10f(rms / 32768.0f);   // 16-bit full scale; <= 0
  return dbfs + Storage::noiseDbOffset();        // -> approx dB SPL
}

// Immediate peak-to-peak probe (doesn't disturb the rolling window). Used by the
// self-test/diagnostics so a working mic shows a real value right away.
float noiseProbe(uint16_t windowMs) {
#if HAS_I2S_MIC
  (void)windowMs;
  return Audio::micLevel();              // I2S task already maintains the rolling level
#elif HAS_MIC
  uint32_t start = millis();
  int mn = 4095, mx = 0;
  while (millis() - start < windowMs) {
    int v = analogRead(PIN_MIC);
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  float pp = (mx - mn) / s_noiseScale;
  return pp < 0 ? 0 : (pp > 1 ? 1 : pp);
#else
  (void)windowMs;
  return 0;                             // no microphone present
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

bool readHumidity(float& pct) {
#if HAS_TEMP
  if (millis() < SENSOR_WARMUP_MS) {
    pct = NAN;
    return false;
  }
  refreshDht(false);                    // throttled refresh; keeps the last good value
  if (!s_humidOk) {
    pct = NAN;
    return false;
  }
  pct = s_humid;
  return true;
#else
  pct = NAN; return false;
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
  // Scans the single shared Wire bus — both the FT6336 touch (0x38) and the ToF (0x29) should appear.
  int n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { if (n < maxOut) out[n] = a; n++; }
  }
  return n;
}

} // namespace Sensors
