#include "Session.h"
#include "config.h"
#include "focus_load.h"
#include "Sensors.h"
#include <esp_timer.h>
#include <math.h>

static uint32_t s_targetSec = 0;
static volatile int32_t  s_remainingMs = 0;
static volatile uint32_t s_actualMs = 0;
static time_t   s_startEpoch = 0;
static Mode     s_mode = MODE_WORK;
static int      s_breaks = 0, s_presInt = 0;
static Sample   s_samples[MAX_SAMPLES];
static int      s_count = 0;
static uint32_t s_lastSample = 0;
static unsigned long s_samplePeriodMs = SAMPLE_PERIOD_MS;
static float    s_noiseSum = 0, s_noisePeak = 0;
static int      s_noiseN = 0, s_lastFle = 0;

static esp_timer_handle_t s_clockTimer = nullptr;
static volatile bool s_clockActive = false;
static volatile bool s_clockPaused = false;
static volatile bool s_presentFlag = true;

static void onClockTimer(void* arg) {
  (void)arg;
  if (!s_clockActive || s_clockPaused || !s_presentFlag) return;
  s_remainingMs -= (int32_t)SESSION_CLOCK_MS;
  s_actualMs += SESSION_CLOCK_MS;
}

static void ensureClockTimer() {
  if (s_clockTimer) return;
  esp_timer_create_args_t args = {};
  args.callback = onClockTimer;
  args.name = "session";
  args.dispatch_method = ESP_TIMER_TASK;
  esp_timer_create(&args, &s_clockTimer);
}

static void startClockTimer() {
  ensureClockTimer();
  s_clockActive = true;
  s_clockPaused = false;
  esp_timer_stop(s_clockTimer);
  esp_timer_start_periodic(s_clockTimer, SESSION_CLOCK_MS * 1000ULL);
}

static void recordSample() {
  if (s_count >= MAX_SAMPLES) return;
  int elapsed = (int)(s_actualMs / 1000);
  float tc; float lux, var;
  bool ht = Sensors::readTemp(tc);
  bool hl = Sensors::readLight(lux, var);
  float nz = Sensors::noise();
  int fle = FocusLoad::compute(elapsed, s_targetSec, nz, hl ? var : 0, s_presInt);
  s_samples[s_count++] = { (uint16_t)elapsed, (uint8_t)fle, nz, ht ? tc : NAN, hl ? lux : 0 };
  s_noiseSum += nz; s_noiseN++;
  if (nz > s_noisePeak) s_noisePeak = nz;
  s_lastFle = fle;
  Serial.printf("[session] sample #%d t=%ds period=%lums fle=%d\n",
                s_count, elapsed, s_samplePeriodMs, fle);
}

namespace Session {

void start(Mode m, int durationMin, time_t epoch) {
  stopClock();
  s_mode = m;
  s_targetSec = (uint32_t)durationMin * 60;
  s_remainingMs = (int32_t)s_targetSec * 1000;
  s_actualMs = 0;
  s_startEpoch = epoch;
  s_breaks = 0; s_presInt = 0;
  s_count = 0; s_lastSample = millis();
  s_noiseSum = 0; s_noisePeak = 0; s_noiseN = 0; s_lastFle = 0;
  s_samplePeriodMs = SAMPLE_PERIOD_MS;
  s_presentFlag = true;
  startClockTimer();
}

void setSamplePeriodMs(unsigned long ms) { s_samplePeriodMs = ms; }
unsigned long samplePeriodMs() { return s_samplePeriodMs; }

void tick(bool present) {
  s_presentFlag = present;
  if (s_samplePeriodMs == 0) return;
  uint32_t now = millis();
  if (now - s_lastSample >= s_samplePeriodMs) {
    s_lastSample = now;
    recordSample();
  }
}

void pauseClock() {
  s_clockPaused = true;
  if (s_clockTimer) esp_timer_stop(s_clockTimer);
}

void resumeClock() {
  s_clockPaused = false;
  if (s_clockActive && s_clockTimer)
    esp_timer_start_periodic(s_clockTimer, SESSION_CLOCK_MS * 1000ULL);
}

void stopClock() {
  s_clockActive = false;
  s_clockPaused = false;
  if (s_clockTimer) esp_timer_stop(s_clockTimer);
}

void addTime(int sec) {
  if (sec <= 0) return;
  s_targetSec   += (uint32_t)sec;
  s_remainingMs += (int32_t)sec * 1000;
}

bool finished() { return s_remainingMs <= 0; }
void addBreak() { s_breaks++; }
void addPresenceInterruption() { s_presInt++; }

int remainingMs()    { return s_remainingMs; }
int remainingSec()   { int s = s_remainingMs / 1000; return s < 0 ? 0 : s; }
int targetSec()      { return s_targetSec; }
int actualFocusSec() { return (int)(s_actualMs / 1000); }
int actualFocusMin() { return (int)(s_actualMs / 60000); }
int breaks()               { return s_breaks; }
int presenceInterruptions(){ return s_presInt; }
int lastFle()        { return s_lastFle; }

const Sample* samples() { return s_samples; }
int sampleCount()       { return s_count; }

void restore(const SessionCheckpoint& cp) {
  stopClock();
  s_mode = cp.mode;
  s_targetSec = cp.targetSec;
  s_remainingMs = cp.remainingMs;
  s_actualMs = cp.actualMs;
  s_startEpoch = cp.startEpoch;
  s_breaks = cp.breaks;
  s_presInt = cp.presInt;
  // Clamp the restored tail length: cp.tail[] holds at most CHECKPOINT_TAIL_MAX. A corrupted-NVS tailCount
  // would otherwise drive an OOB read of cp.tail[] and an OOB write into s_samples[]. Storage clamps on load
  // too, so this is belt-and-suspenders — but it's free and closes a real latent buffer overflow.
  int tailN = cp.tailCount > CHECKPOINT_TAIL_MAX ? CHECKPOINT_TAIL_MAX : cp.tailCount;
  s_count = tailN;
  for (int i = 0; i < tailN; i++)
    s_samples[i] = cp.tail[i];
  s_lastSample = cp.lastSampleMs;
  s_noiseSum = cp.noiseSum;
  s_noisePeak = cp.noisePeak;
  s_noiseN = cp.noiseN;
  s_lastFle = tailN > 0 ? cp.tail[tailN - 1].fle : 0;
  s_presentFlag = true;
  ensureClockTimer();
  s_clockActive = true;
  s_clockPaused = true;
}

void alignSampleTimer() { s_lastSample = millis(); }

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
  cp.sampleCount = (uint8_t)(s_count > 255 ? 255 : s_count);
  int tailN = s_count < CHECKPOINT_TAIL_MAX ? s_count : CHECKPOINT_TAIL_MAX;
  cp.tailCount = (uint8_t)tailN;
  int start = s_count - tailN;
  for (int i = 0; i < tailN; i++)
    cp.tail[i] = s_samples[start + i];
  cp.noiseSum = s_noiseSum;
  cp.noisePeak = s_noisePeak;
  cp.noiseN = (uint16_t)(s_noiseN > 65535 ? 65535 : s_noiseN);
  cp.lastSampleMs = s_lastSample;
  return cp;
}

Mode mode() { return s_mode; }

SessionRecord finish(const char* status, time_t endEpoch, uint32_t seq) {
  stopClock();
  SessionRecord r = {};
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
  r.actualFocusSec = (int)(s_actualMs / 1000);
  if (r.startedAt == 0 && r.endedAt > 0)
    r.startedAt = r.endedAt - r.actualFocusSec;
  r.mode = s_mode;
  r.status = status;
  r.breaks = s_breaks;
  r.presenceInterruptions = s_presInt;

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
      ? (int)((fleSum + s_count / 2) / s_count)
      : FocusLoad::compute(r.actualFocusSec, s_targetSec, r.noiseAvg, 0, s_presInt);
  return r;
}

} // namespace Session
