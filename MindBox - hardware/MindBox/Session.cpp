#include "Session.h"
#include "config.h"
#include "focus_load.h"
#include "Sensors.h"
#include <math.h>

static uint32_t s_targetSec = 0;
static int32_t  s_remainingMs = 0;
static uint32_t s_actualMs = 0;
static uint32_t s_lastTick = 0;
static time_t   s_startEpoch = 0;
static Mode     s_mode = MODE_WORK;
static int      s_breaks = 0, s_presInt = 0;
static Sample   s_samples[MAX_SAMPLES];
static int      s_count = 0;
static uint32_t s_lastSample = 0;
static float    s_noiseSum = 0, s_noisePeak = 0;
static int      s_noiseN = 0, s_lastFle = 0;

static void recordSample() {
  if (s_count >= MAX_SAMPLES) return;
  int elapsed = s_actualMs / 1000;
  float tc; float lux, var;
  bool ht = Sensors::readTemp(tc);
  bool hl = Sensors::readLight(lux, var);
  float nz = Sensors::noise();
  int fle = FocusLoad::compute(elapsed, s_targetSec, nz, hl ? var : 0, s_presInt);
  s_samples[s_count++] = { (uint16_t)elapsed, (uint8_t)fle, nz, ht ? tc : NAN, hl ? lux : 0 };
  s_noiseSum += nz; s_noiseN++;
  if (nz > s_noisePeak) s_noisePeak = nz;
  s_lastFle = fle;
}

namespace Session {

void start(Mode m, int durationMin, time_t epoch) {
  s_mode = m;
  s_targetSec = (uint32_t)durationMin * 60;
  s_remainingMs = (int32_t)s_targetSec * 1000;
  s_actualMs = 0; s_lastTick = millis();
  s_startEpoch = epoch;
  s_breaks = 0; s_presInt = 0;
  s_count = 0; s_lastSample = millis();
  s_noiseSum = 0; s_noisePeak = 0; s_noiseN = 0; s_lastFle = 0;
}

void tick(bool present) {
  uint32_t now = millis();
  uint32_t dt = now - s_lastTick;
  s_lastTick = now;
  if (present) { s_remainingMs -= dt; s_actualMs += dt; }
  if (now - s_lastSample >= SAMPLE_PERIOD_MS) { s_lastSample = now; recordSample(); }
}

void markResumed() { s_lastTick = millis(); }

bool finished() { return s_remainingMs <= 0; }
void addBreak() { s_breaks++; }
void addPresenceInterruption() { s_presInt++; }

int remainingMs()    { return s_remainingMs; }
int remainingSec()   { int s = s_remainingMs / 1000; return s < 0 ? 0 : s; }
int targetSec()      { return s_targetSec; }
int actualFocusSec() { return s_actualMs / 1000; }
int actualFocusMin() { return s_actualMs / 60000; }
int breaks()               { return s_breaks; }
int presenceInterruptions(){ return s_presInt; }
int lastFle()        { return s_lastFle; }

const Sample* samples() { return s_samples; }
int sampleCount()       { return s_count; }

void restore(const SessionCheckpoint& cp) {
  s_mode = cp.mode;
  s_targetSec = cp.targetSec;
  s_remainingMs = cp.remainingMs;
  s_actualMs = cp.actualMs;
  s_lastTick = millis();
  s_startEpoch = cp.startEpoch;
  s_breaks = cp.breaks;
  s_presInt = cp.presInt;
  s_count = 0;
  s_lastSample = millis();
  s_noiseSum = 0;
  s_noisePeak = 0;
  s_noiseN = 0;
  s_lastFle = 0;
}

SessionCheckpoint snapshot(SysState sysState) {
  SessionCheckpoint cp = {};
  cp.sysState = sysState;
  cp.mode = s_mode;
  cp.remainingMs = s_remainingMs;
  cp.actualMs = s_actualMs;
  cp.targetSec = s_targetSec;
  cp.breaks = (uint8_t)s_breaks;
  cp.presInt = (uint8_t)s_presInt;
  cp.startEpoch = s_startEpoch;
  return cp;
}

Mode mode() { return s_mode; }

SessionRecord finish(const char* status, time_t endEpoch, uint32_t seq) {
  SessionRecord r = {};
  // v4-shaped session UUID (idempotency key with deviceId on the server)
  uint32_t a = (uint32_t)ESP.getEfuseMac() ^ (seq * 2654435761u);
  uint32_t b = (uint32_t)(ESP.getEfuseMac() >> 32) ^ millis();
  uint32_t c = esp_random(), d = esp_random();
  snprintf(r.sessionId, sizeof(r.sessionId), "%08x-%04x-4%03x-%04x-%04x%08x",
           a, (uint16_t)(b >> 16), (uint16_t)(b & 0x0fff),
           (uint16_t)((c & 0x3fff) | 0x8000), (uint16_t)(c >> 16), d);
  r.clientSeq = seq;
  r.startedAt = s_startEpoch;
  r.endedAt   = endEpoch;
  r.targetSec = s_targetSec;
  r.actualFocusSec = s_actualMs / 1000;
  if (r.startedAt == 0 && r.endedAt > 0)
    r.startedAt = r.endedAt - r.actualFocusSec;   // backfill if NTP synced mid-session
  r.mode = s_mode;
  r.status = status;
  r.breaks = s_breaks;
  r.presenceInterruptions = s_presInt;

  // Aggregate the env + FLE averages from the per-minute samples (not a one-off
  // recompute). tempC stays NaN when there is no temp sensor; lightLux averages
  // 0 until a light sensor exists. focusLoadAvg is the mean of sampled FLEs.
  long fleSum = 0;
  double tempSum = 0;  int tempN = 0;
  double luxSum = 0;
  for (int i = 0; i < s_count; i++) {
    fleSum += s_samples[i].fle;
    if (!isnan(s_samples[i].tempC)) { tempSum += s_samples[i].tempC; tempN++; }
    luxSum += s_samples[i].lightLux;
  }
  r.noiseAvg  = s_noiseN ? s_noiseSum / s_noiseN : 0;
  r.noisePeak = s_noisePeak;
  r.tempC     = tempN ? (float)(tempSum / tempN) : NAN;
  r.lightLux  = s_count ? (float)(luxSum / s_count) : 0;
  r.focusLoadAvg = s_count
      ? (int)((fleSum + s_count / 2) / s_count)   // rounded mean of sampled FLE
      : FocusLoad::compute(r.actualFocusSec, s_targetSec, r.noiseAvg, 0, s_presInt);
  return r;
}

} // namespace Session
