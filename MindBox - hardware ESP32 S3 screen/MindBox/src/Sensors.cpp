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

#if HAS_PRESENCE
// --- Presence occupancy estimator state (see config.h PRESENCE_* + Sensors.cpp updateOccupancy) ---
static int      s_bgDist    = PRESENCE_ABS_MAX;   // learned empty-desk distance (slow EWMA)
static float    s_movement  = 0.0f;               // micro-motion energy (mm, EWMA) — ~0 for a static object
static float    s_conf      = 0.0f;               // occupancy confidence 0..1 (EWMA + hysteresis)
static bool     s_occupied  = false;              // debounced present() output
static int      s_medRing[3] = { -1, -1, -1 };    // last-3 valid distances for median smoothing
static uint32_t s_medN      = 0;
static int      s_prevDist  = -1;
static bool     s_seenLife  = false;              // have we ever seen movement/activity (else a boot-time object)
static bool     s_wasNear   = false;              // previous frame's near bit (arrival edge detection)
static bool     s_arrived   = false;              // this near target APPEARED (walked in) vs was-there-at-boot
static uint16_t s_notNearFrames = 0;              // consecutive not-near/invalid frames before a near frame
static uint32_t s_lastMoveAt = 0, s_lastActivityAt = 0, s_lastNearAt = 0;
static float    s_sensGuard = 1.0f, s_sensMove = 1.0f, s_sensStill = 1.0f;  // sensitivity scales (Low/Med/High)
#endif

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
    vl53.VL53L1X_SetDistanceMode(1);             // short range: lower ranging noise at desk distance
    vl53.setTimingBudget(50);
    vl53.startRanging();
    s_tofPresent = true;
  } else {
    s_tofPresent = false;                        // ToF dead (bus fine) -> degrade
  }
#endif
  return freed;
}

#if HAS_PRESENCE
static int median3(int a, int b, int c) {
  if (a > b) { int t = a; a = b; b = t; }
  if (b > c) { int t = b; b = c; c = t; }
  if (a > b) { int t = a; a = b; b = t; }
  return b;
}

// The occupancy estimator: called once per ToF poll with the raw distance and whether the range was valid
// (status 0 + plausible). It maintains an adaptive empty-desk baseline, a micro-motion signal, mic/light
// fusion, and a hysteresis'd confidence. `present()` returns the debounced `s_occupied` output. Called even on
// INVALID reads (valid=false) so a "no target" range (person left) still decays confidence toward away.
static void updateOccupancy(int rawDist, bool valid, uint32_t now) {
  bool nearNow = false;

  // Fusion FIRST: mic level + light p-p variance corroborate a living occupant. Conservative — it can HOLD/
  // boost confidence but never fabricate presence with no near target (so a loud empty room != present).
  // Computed before the distance logic so the near test + baseline learning can consult it this frame.
  bool activity = (s_noise > PRESENCE_FUSE_NOISE);
#if HAS_LIGHT
  if (s_lightVar > PRESENCE_FUSE_LIGHTVAR) activity = true;
#endif
  if (activity) { s_lastActivityAt = now; s_seenLife = true; }
  bool activityRecent = (now - s_lastActivityAt) < PRESENCE_FUSE_RECENT_MS;

  if (valid) {
    // Median-of-3 smoothing kills single-sample spikes while preserving real fidget/posture motion.
    s_medRing[s_medN % 3] = rawDist; s_medN++;
    int working = (s_medN >= 3) ? median3(s_medRing[0], s_medRing[1], s_medRing[2]) : rawDist;
    s_lastDist = working;

    // Micro-motion: EWMA of frame-to-frame deltas above the noise floor.
    if (s_prevDist > 0) {
      int delta = working > s_prevDist ? working - s_prevDist : s_prevDist - working;
      float sig = delta > PRESENCE_MOVE_NOISE_MM ? (float)delta : 0.0f;
      s_movement += PRESENCE_MOVE_ALPHA * (sig - s_movement);
      if (delta > PRESENCE_MOVE_NOISE_MM) { s_lastMoveAt = now; s_seenLife = true; }
    }
    s_prevDist = working;

    bool movingRecent = (now - s_lastMoveAt) < PRESENCE_MOVE_RECENT_MS;

    // Adaptive near test: closer than the learned empty-desk baseline (by a sensitivity-scaled guard).
    // A MOVING in-range target is also near regardless of the baseline: walls/monitors are dead still, so
    // motion alone proves this echo is not background. Without this, a person seated less than the guard
    // above the baseline was "not near" and then got LEARNED INTO the baseline (poisoning it), which is how
    // the box got stuck saying "away" at an occupied desk.
    int guard = (int)(PRESENCE_BG_GUARD_MM * s_sensGuard);
    int nearThresh = s_bgDist - guard;
    if (nearThresh > PRESENCE_ABS_MAX) nearThresh = PRESENCE_ABS_MAX;
    bool inRange = (working >= PRESENCE_MIN_MM && working <= PRESENCE_ABS_MAX);
    nearNow = inRange && (working <= nearThresh || (s_seenLife && movingRecent));

    if (nearNow) {
      s_lastNearAt = now;
      // Arrival edge: a target that APPEARS after the desk was clear for a while can only be a person
      // walking in — a static object cannot newly show up at near range on its own. Count the arrival as
      // life (the person may sit down calmly between two 200ms polls, or re-acquire through an invalid
      // stretch where no frame-to-frame delta ever fires) and remember it: an arrived occupant is never
      // demoted to "object" while they stay near. (Present at boot -> no edge -> strict object logic.)
      if (!s_wasNear && s_notNearFrames >= PRESENCE_ARRIVE_FRAMES) {
        s_arrived = true;
        s_seenLife = true;
        s_lastMoveAt = now;
      }
      s_notNearFrames = 0;
    } else {
      if (s_notNearFrames < 0xFFFF) s_notNearFrames++;
      // Learn the empty-desk distance ONLY from not-near reads with NO life signs — a fidgeting/typing
      // person just beyond the guard band must never be absorbed into the "empty desk" baseline.
      if (!movingRecent && !activityRecent) {
        s_bgDist += (int)((working - s_bgDist) * PRESENCE_BG_ALPHA);
        if (s_bgDist > 4000) s_bgDist = 4000;
        if (s_bgDist < PRESENCE_MIN_MM) s_bgDist = PRESENCE_MIN_MM;
      }
    }
  } else {
    s_prevDist = -1;   // a re-acquired target must not register as one giant jump
    s_medN = 0;        // stale pre-absence distances must not median-filter the return frames
    if (s_notNearFrames < 0xFFFF) s_notNearFrames++;
  }

  bool moving = ((now - s_lastMoveAt) < PRESENCE_MOVE_RECENT_MS) ||
                (s_movement > PRESENCE_MOVE_PRESENT * s_sensMove);

  float score;
  if (nearNow) {
    uint32_t lastLife = (s_lastActivityAt > s_lastMoveAt) ? s_lastActivityAt : s_lastMoveAt;
    uint32_t stillFor = now - lastLife;
    unsigned long stillLimit = (unsigned long)(PRESENCE_STILL_OBJECT_MS * s_sensStill);
    if (moving || activityRecent) score = 1.0f;               // near + alive -> clearly a person
    else if (s_arrived) score = 0.85f;                        // they ARRIVED: hold present until they leave
    else if (s_seenLife && stillFor < stillLimit) score = 0.70f;  // near, recently alive -> hold (grace)
    else score = 0.0f;                                        // near but dead-still + silent -> object, not person
  } else {
    // Possibly leaned out of the ~27deg cone but still working -> hold present briefly.
    if (s_occupied && activityRecent && (now - s_lastNearAt) < PRESENCE_FUSE_HOLD_MS) score = 0.50f;
    else score = 0.0f;
    // Target genuinely gone (not just a lean-out): the next near frame is a fresh arrival.
    if ((now - s_lastNearAt) > PRESENCE_FUSE_HOLD_MS) s_arrived = false;
  }
  s_wasNear = nearNow;

  s_conf += PRESENCE_CONF_ALPHA * (score - s_conf);
  if (s_conf >= PRESENCE_CONF_ENTER) s_occupied = true;        // hysteresis: two thresholds = no flicker
  else if (s_conf <= PRESENCE_CONF_LEAVE) s_occupied = false;
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
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);   // ONE shared I2C master. Touch::begin() already started this Wire
  Wire.setClock(400000);                  // (USE_TOUCH); re-begin is harmless. The ToF (0x29) and FT6336 touch
  Wire.setTimeOut(I2C_TIMEOUT_MS);        // (0x38) are two addresses on this single bus — no pad-swapping.
  if (vl53.begin(0x29, &Wire)) {
    vl53.VL53L1X_SetDistanceMode(1);   // short range: lower ranging noise at desk distance (~1.3m max is plenty)
    vl53.setTimingBudget(50);
    vl53.startRanging();
    s_tofPresent = true;
    // Seed the occupancy estimator: baseline far, "life" clock unset so a static object at boot isn't "present".
    s_bgDist = PRESENCE_ABS_MAX;
    s_seenLife = false;
    s_wasNear = false;
    s_arrived = false;
    s_notNearFrames = 0;
    s_lastMoveAt = s_lastActivityAt = s_lastNearAt = millis();
    setPresenceSensitivity(Storage::presenceSensIdx());
    Serial.println("[tof] VL53L1X init OK @0x29 - ranging (short mode, occupancy estimator)");
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
    if (vl53.dataReady()) {
      int16_t d = vl53.distance();
      uint8_t status = vl53.vl_status;
      vl53.clearInterrupt();
      // Gate on the sensor's own range status (0 = valid) AND a plausibility clamp — a status-invalid read with a
      // plausible mm value used to be trusted. Feed the estimator either way: an invalid/"no target" read (the
      // person left) must still decay confidence toward away, not freeze the last "present" bit.
      bool valid = (status == 0 && d > 0 && d < 4000);
      updateOccupancy(d, valid, millis());
#if TOF_DEBUG
      Serial.printf("[tof] raw=%d st=%u valid=%d base=%d move=%.0f conf=%.2f occ=%d\n",
                    d, (unsigned)status, valid ? 1 : 0, s_bgDist, s_movement, s_conf, s_occupied ? 1 : 0);
#endif
    }
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
  if (!s_tofPresent) return true;             // can't tell -> assume present (never a false auto-pause)
  return s_occupied;                          // debounced occupancy estimate (updateOccupancy)
#else
  return true;
#endif
}

unsigned long absentForMs() { return present() ? 0 : (millis() - s_absentAt); }

float occupancyConfidence() {
#if HAS_PRESENCE
  return s_tofPresent ? s_conf : 1.0f;
#else
  return 1.0f;
#endif
}

float presenceMovement() {
#if HAS_PRESENCE
  return s_movement;
#else
  return 0.0f;
#endif
}

int presenceBaselineMm() {
#if HAS_PRESENCE
  return s_tofPresent ? s_bgDist : -1;
#else
  return -1;
#endif
}

// Menu "Sensitivity": scale the estimator's thresholds. Low = strict (harder to call present); High = eager
// (easier, and holds a still occupant present longer before treating them as an object).
void setPresenceSensitivity(uint8_t idx) {
#if HAS_PRESENCE
  if (idx > 2) idx = 1;
  static const float guard[3] = { 1.4f, 1.0f, 0.6f };   // Low..High: smaller guard = easier to be "near"
  static const float move[3]  = { 1.5f, 1.0f, 0.6f };   // Low..High: smaller = less movement needed for "alive"
  static const float still[3] = { 0.6f, 1.0f, 1.8f };   // Low..High: larger = holds a still occupant longer
  s_sensGuard = guard[idx];
  s_sensMove  = move[idx];
  s_sensStill = still[idx];
#else
  (void)idx;
#endif
}

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
