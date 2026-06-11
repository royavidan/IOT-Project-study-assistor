#include "Storage.h"
#include "config.h"
#include <Preferences.h>
#include <time.h>

// Optional compile-time defaults (Wi-Fi / app URL / secret / device id).
#if defined(__has_include)
#  if __has_include("SECRETS.h")
#    include "SECRETS.h"
#  endif
#endif
#ifndef SECRET_WIFI_SSID
#  define SECRET_WIFI_SSID ""
#  define SECRET_WIFI_PASS ""
#  define SECRET_APP_BASE_URL ""
#  define SECRET_DEVICE_SECRET ""
#  define SECRET_DEVICE_ID ""
#endif

static Preferences prefs;
static uint32_t    s_liveFocusSec = 0;

static const uint8_t SLOG_VER = 2;
static const int     SLOG_V1_MAX = 8;

#pragma pack(push, 1)
struct SessionLogEntryV1 {
  uint32_t actualFocusSec;
  uint16_t targetSec;
  uint8_t  mode;
  uint8_t  breaks;
  uint8_t  presInt;
  uint8_t  status;
};
#pragma pack(pop)

static bool haveClock() {
#if ENABLE_WIFI
  return time(nullptr) > 1700000000L;
#else
  return false;
#endif
}

static uint32_t calendarDayId() {
  if (!haveClock()) return prefs.getUInt("manualDay", 0);
  return (uint32_t)(time(nullptr) / 86400L);
}

static void zeroTodayCounters() {
  prefs.putUInt("todayFocus", 0);
  prefs.putUShort("todayCnt", 0);
  prefs.putUShort("todaySets", 0);
  prefs.putBool("goalCelebrated", false);
}

static void recomputeTodayFromLog() {
  uint32_t day = calendarDayId();
  uint32_t focusSec = 0;
  uint16_t focusCnt = 0;
  SessionLogEntry ring[SESSION_LOG_MAX];
  int n = prefs.getUChar("slogN", 0);
  if (n > SESSION_LOG_MAX) n = SESSION_LOG_MAX;
  if (prefs.getBytes("slog", ring, sizeof(ring)) < sizeof(SessionLogEntry)) return;
  for (int i = 0; i < n; i++) {
    if (ring[i].mode != MODE_WORK) continue;
    if (ring[i].utcDay != day) continue;
    focusSec += ring[i].actualFocusSec;
    focusCnt++;
  }
  prefs.putUInt("todayFocus", focusSec);
  prefs.putUShort("todayCnt", focusCnt);
}

static void migrateSessionLog() {
  uint8_t ver = prefs.getUChar("slogVer", 0);
  if (ver >= SLOG_VER) return;

  SessionLogEntry newRing[SESSION_LOG_MAX] = {};
  int copyN = 0;

  if (ver == 0) {
    SessionLogEntryV1 oldRing[SLOG_V1_MAX];
    size_t got = prefs.getBytes("slog", oldRing, sizeof(oldRing));
    copyN = prefs.getUChar("slogN", 0);
    if (copyN > SLOG_V1_MAX) copyN = SLOG_V1_MAX;
    int oldSlots = (int)(got / sizeof(SessionLogEntryV1));
    if (copyN > oldSlots) copyN = oldSlots;
    for (int i = 0; i < copyN; i++) {
      newRing[i].actualFocusSec = oldRing[i].actualFocusSec;
      newRing[i].targetSec      = oldRing[i].targetSec;
      newRing[i].mode           = oldRing[i].mode;
      newRing[i].breaks         = oldRing[i].breaks;
      newRing[i].presInt        = oldRing[i].presInt;
      newRing[i].status         = oldRing[i].status;
      newRing[i].utcDay         = 0;
    }
  }

  prefs.putBytes("slog", newRing, sizeof(newRing));
  prefs.putUChar("slogN", (uint8_t)copyN);
  prefs.putUChar("slogVer", SLOG_VER);
}

static String makeId() {
  uint64_t mac = ESP.getEfuseMac();
  char b[24];
  snprintf(b, sizeof(b), "mindbox-%04x%08x", (uint16_t)(mac >> 32), (uint32_t)mac);
  return String(b);
}

// Seed an NVS credential from SECRETS.h only if it's set and not already stored
// (so a value entered later via serial 'w' persists over the compile-time default).
static void seedCred(const char* key, const char* val) {
  if (strlen(val) && prefs.getString(key, "").length() == 0) prefs.putString(key, val);
}

static void migrateDurations() {
  if (prefs.isKey("workDur")) return;
  int legacy = prefs.getInt("lastDur", DUR_DEFAULT_MIN);
  prefs.putInt("workDur", legacy);
  prefs.putInt("breakDur", 5);
}

namespace Storage {

void begin() {
  prefs.begin("mindbox", false);
  if (prefs.getString("devId", "").length() == 0)
    prefs.putString("devId", strlen(SECRET_DEVICE_ID) ? String(SECRET_DEVICE_ID) : makeId());
  seedCred("wSsid",     SECRET_WIFI_SSID);
  seedCred("wPass",     SECRET_WIFI_PASS);
  seedCred("appUrl",    SECRET_APP_BASE_URL);
  seedCred("devSecret", SECRET_DEVICE_SECRET);
  migrateDurations();
  migrateSessionLog();
  syncDayBoundary();
}

String deviceId() { return prefs.getString("devId", makeId()); }

int workDurationMin()  { return prefs.getInt("workDur", DUR_DEFAULT_MIN); }
int breakDurationMin() { return prefs.getInt("breakDur", 5); }
void setWorkDuration(int m)  { prefs.putInt("workDur", m); }
void setBreakDuration(int m) { prefs.putInt("breakDur", m); }

int  cycleCount()            { return prefs.getInt("cycles", CYCLE_DEFAULT); }
void setCycleCount(int n)    { prefs.putInt("cycles", n); }

uint32_t nextSeq() {
  uint32_t s = prefs.getUInt("seq", 0) + 1;
  prefs.putUInt("seq", s);
  return s;
}

DeviceConfig loadConfig(const DeviceConfig& d) {
  DeviceConfig c = d;
  c.showTimer        = prefs.getBool("showTimer", d.showTimer);
  c.hapticsEnabled   = prefs.getBool("haptics",   d.hapticsEnabled);
  c.adaptiveCoaching = prefs.getBool("adaptive",  d.adaptiveCoaching);
  c.coachingNudgeScreen = prefs.getBool("coachNudge", d.coachingNudgeScreen);
  c.coachingNudgeHaptic = prefs.getBool("coachHap",   d.coachingNudgeHaptic);
  c.coachingAutoPause   = prefs.getBool("coachPause", d.coachingAutoPause);
  c.nudgesEnabled    = prefs.getBool("nudges",    d.nudgesEnabled);
  c.autoPause        = prefs.getBool("autoPause", d.autoPause);
  c.presencePauseIdx = prefs.getUChar("pauseIdx", d.presencePauseIdx);
  c.presenceEndIdx   = prefs.getUChar("endIdx",   d.presenceEndIdx);
  c.dailyGoalMin     = prefs.getUShort("goal",    d.dailyGoalMin);
  return c;
}

void saveConfig(const DeviceConfig& c) {
  prefs.putBool("showTimer", c.showTimer);
  prefs.putBool("haptics",   c.hapticsEnabled);
  prefs.putBool("adaptive",  c.adaptiveCoaching);
  prefs.putBool("coachNudge", c.coachingNudgeScreen);
  prefs.putBool("coachHap",   c.coachingNudgeHaptic);
  prefs.putBool("coachPause", c.coachingAutoPause);
  prefs.putBool("nudges",    c.nudgesEnabled);
  prefs.putBool("autoPause", c.autoPause);
  prefs.putUChar("pauseIdx", c.presencePauseIdx);
  prefs.putUChar("endIdx",   c.presenceEndIdx);
  prefs.putUShort("goal",    c.dailyGoalMin);
}

bool paired()          { return prefs.getBool("paired", false); }
void setPaired(bool p) { if (prefs.getBool("paired", false) != p) prefs.putBool("paired", p); }

String wifiSsid()                      { return prefs.getString("wSsid", ""); }
void   setWifiSsid(const String& s)    { prefs.putString("wSsid", s); }
String wifiPass()                      { return prefs.getString("wPass", ""); }
void   setWifiPass(const String& s)    { prefs.putString("wPass", s); }
String appBaseUrl()                    { return prefs.getString("appUrl", ""); }
void   setAppBaseUrl(const String& s)  { prefs.putString("appUrl", s); }
String deviceSecret()                  { return prefs.getString("devSecret", ""); }
void   setDeviceSecret(const String& s){ prefs.putString("devSecret", s); }

void saveSessionLog(const SessionRecord& r) {
  SessionLogEntry ring[SESSION_LOG_MAX];
  prefs.getBytes("slog", ring, sizeof(ring));

  for (int i = SESSION_LOG_MAX - 1; i > 0; i--)
    ring[i] = ring[i - 1];

  ring[0].actualFocusSec = (uint32_t)r.actualFocusSec;
  ring[0].targetSec      = (uint16_t)r.targetSec;
  ring[0].mode           = (uint8_t)r.mode;
  ring[0].breaks         = (uint8_t)r.breaks;
  ring[0].presInt        = (uint8_t)r.presenceInterruptions;
  ring[0].status         = sessionStatusIdx(r.status);
  ring[0].utcDay         = calendarDayId();

  prefs.putBytes("slog", ring, sizeof(ring));
  int n = prefs.getUChar("slogN", 0);
  if (n < SESSION_LOG_MAX) n++;
  prefs.putUChar("slogN", (uint8_t)n);
  if (r.mode == MODE_WORK)
    prefs.putUInt("totFocus", prefs.getUInt("totFocus", 0) + (uint32_t)r.actualFocusSec);
}

SessionLogEntry lastSessionLog() {
  SessionLogEntry e = {};
  SessionLogEntry ring[SESSION_LOG_MAX];
  if (prefs.getBytes("slog", ring, sizeof(ring)) >= sizeof(SessionLogEntry))
    e = ring[0];
  return e;
}

bool sessionLogAt(int index, SessionLogEntry& out) {
  if (index < 0) return false;
  int n = sessionLogCount();
  if (index >= n) return false;
  SessionLogEntry ring[SESSION_LOG_MAX];
  if (prefs.getBytes("slog", ring, sizeof(ring)) < sizeof(SessionLogEntry)) return false;
  out = ring[index];
  return true;
}

uint32_t totalFocusSec() { return prefs.getUInt("totFocus", 0); }
int      sessionLogCount() { return prefs.getUChar("slogN", 0); }

void setLiveFocusSec(uint32_t sec) { s_liveFocusSec = sec; }

uint32_t todayFocusSec() { return prefs.getUInt("todayFocus", 0); }

uint32_t todayDisplaySec() { return todayFocusSec() + s_liveFocusSec; }

int todayFocusCount() { return prefs.getUShort("todayCnt", 0); }

int todaySetsCount() { return prefs.getUShort("todaySets", 0); }

void syncDayBoundary() {
  uint32_t day = calendarDayId();
  uint32_t stored = prefs.getUInt("lastDayId", 0xFFFFFFFFUL);
  if (stored == 0xFFFFFFFFUL) {
    prefs.putUInt("lastDayId", day);
    return;
  }
  if (day != stored) {
    zeroTodayCounters();
    prefs.putUInt("lastDayId", day);
    if (haveClock()) recomputeTodayFromLog();
  }
}

void resetToday() {
  zeroTodayCounters();
  if (!haveClock())
    prefs.putUInt("manualDay", prefs.getUInt("manualDay", 0) + 1);
  prefs.putUInt("lastDayId", calendarDayId());
}

void recordSetComplete() {
  syncDayBoundary();
  uint16_t n = prefs.getUShort("todaySets", 0);
  prefs.putUShort("todaySets", n + 1);
}

static bool recordWorkFocus(uint32_t sec) {
  if (sec == 0) return false;
  syncDayBoundary();
  uint32_t prev = todayFocusSec();
  uint32_t next = prev + sec;
  prefs.putUInt("todayFocus", next);
  uint16_t cnt = prefs.getUShort("todayCnt", 0);
  prefs.putUShort("todayCnt", cnt + 1);
  uint32_t goalSec = (uint32_t)prefs.getUShort("goal", GOAL_DEFAULT_MIN) * 60UL;
  if (goalSec == 0) return false;
  bool celebrated = prefs.getBool("goalCelebrated", false);
  if (!celebrated && prev < goalSec && next >= goalSec) {
    prefs.putBool("goalCelebrated", true);
    return true;
  }
  return false;
}

bool bufferSession(const SessionRecord& r) {
  saveSessionLog(r);
  uint16_t c = prefs.getUShort("bufN", 0) + 1;
  prefs.putUShort("bufN", c);
  if (r.mode == MODE_WORK)
    return recordWorkFocus((uint32_t)r.actualFocusSec);
  return false;
}

int bufferedCount() { return prefs.getUShort("bufN", 0); }

bool uploadQueueDropped() { return prefs.getBool("uqDrop", false); }

void setUploadQueueDropped(bool v) {
  if (prefs.getBool("uqDrop", false) != v) prefs.putBool("uqDrop", v);
}

void clearUploadQueueDropped() { setUploadQueueDropped(false); }

#pragma pack(push, 1)
struct StoredSample {
  uint16_t t;
  uint8_t  fle;
  float    noise;
  float    tempC;
  float    lightLux;
};

struct StoredCheckpoint {
  uint16_t magic;
  uint8_t  version;
  uint8_t  sysState;
  uint8_t  mode;
  int32_t  remainingMs;
  uint32_t actualMs;
  uint32_t targetSec;
  uint8_t  breaks;
  uint8_t  presInt;
  int32_t  startEpoch;
  uint8_t  setCycleTotal;
  uint8_t  setFocusDone;
  uint8_t  setActive;
  uint8_t  sampleCount;
  uint8_t  tailCount;
  StoredSample tail[CHECKPOINT_TAIL_MAX];
  float    noiseSum;
  float    noisePeak;
  uint16_t noiseN;
  uint32_t lastSampleMs;
};
#pragma pack(pop)

static const uint16_t CK_MAGIC = 0x4D42;
static const uint8_t  CK_VER   = 3;
static const size_t   CK_V2_SIZE = 26;  // StoredCheckpoint through setActive (v1/v2)

static void copyStoredTail(SessionCheckpoint& cp, const StoredCheckpoint& s) {
  cp.sampleCount = s.sampleCount;
  uint8_t n = s.tailCount;
  if (n > CHECKPOINT_TAIL_MAX) n = CHECKPOINT_TAIL_MAX;
  cp.tailCount = n;
  for (int i = 0; i < n; i++) {
    cp.tail[i].t = s.tail[i].t;
    cp.tail[i].fle = s.tail[i].fle;
    cp.tail[i].noise = s.tail[i].noise;
    cp.tail[i].tempC = s.tail[i].tempC;
    cp.tail[i].lightLux = s.tail[i].lightLux;
  }
  cp.noiseSum = s.noiseSum;
  cp.noisePeak = s.noisePeak;
  cp.noiseN = s.noiseN;
  cp.lastSampleMs = s.lastSampleMs;
}

void saveCheckpoint(const SessionCheckpoint& cp) {
  StoredCheckpoint s = {};
  s.magic        = CK_MAGIC;
  s.version      = CK_VER;
  s.sysState     = (uint8_t)cp.sysState;
  s.mode         = (uint8_t)cp.mode;
  s.remainingMs  = cp.remainingMs;
  s.actualMs     = cp.actualMs;
  s.targetSec    = cp.targetSec;
  s.breaks       = (uint8_t)cp.breaks;
  s.presInt      = (uint8_t)cp.presInt;
  s.startEpoch   = (int32_t)cp.startEpoch;
  s.setCycleTotal = cp.setCycleTotal;
  s.setFocusDone  = cp.setFocusDone;
  s.setActive     = cp.setActive;
  s.sampleCount  = cp.sampleCount;
  s.tailCount    = cp.tailCount;
  if (s.tailCount > CHECKPOINT_TAIL_MAX) s.tailCount = CHECKPOINT_TAIL_MAX;
  for (int i = 0; i < s.tailCount; i++) {
    s.tail[i].t = cp.tail[i].t;
    s.tail[i].fle = cp.tail[i].fle;
    s.tail[i].noise = cp.tail[i].noise;
    s.tail[i].tempC = cp.tail[i].tempC;
    s.tail[i].lightLux = cp.tail[i].lightLux;
  }
  s.noiseSum = cp.noiseSum;
  s.noisePeak = cp.noisePeak;
  s.noiseN = cp.noiseN;
  s.lastSampleMs = cp.lastSampleMs;
  prefs.putBytes("ckpt", &s, sizeof(s));
  prefs.putBool("ckActive", true);
}

bool loadCheckpoint(SessionCheckpoint& cp) {
  if (!prefs.getBool("ckActive", false)) return false;
  StoredCheckpoint s = {};
  size_t got = prefs.getBytes("ckpt", &s, sizeof(s));
  if (got < CK_V2_SIZE) return false;
  if (s.magic != CK_MAGIC) return false;
  if (s.version != CK_VER && s.version != 2 && s.version != 1) return false;
  if (s.sysState != ST_RUNNING && s.sysState != ST_PAUSED) return false;
  cp.sysState     = (SysState)s.sysState;
  cp.mode         = (Mode)s.mode;
  cp.remainingMs  = s.remainingMs;
  cp.actualMs     = s.actualMs;
  cp.targetSec    = s.targetSec;
  cp.breaks       = s.breaks;
  cp.presInt      = s.presInt;
  cp.startEpoch   = (time_t)s.startEpoch;
  if (s.version >= 2) {
    cp.setCycleTotal = s.setCycleTotal;
    cp.setFocusDone  = s.setFocusDone;
    cp.setActive     = s.setActive;
  } else {
    cp.setCycleTotal = (uint8_t)cycleCount();
    cp.setFocusDone  = 0;
    cp.setActive     = 1;
  }
  cp.sampleCount = 0;
  cp.tailCount = 0;
  cp.noiseSum = 0;
  cp.noisePeak = 0;
  cp.noiseN = 0;
  cp.lastSampleMs = 0;
  if (s.version >= 3 && got >= sizeof(s))
    copyStoredTail(cp, s);
  return true;
}

void clearCheckpoint() { prefs.putBool("ckActive", false); }
bool hasCheckpoint()   { return prefs.getBool("ckActive", false); }

static bool validNoiseScale(float v)   { return v >= 100.0f && v <= 20000.0f; }
static bool validLightLuxScale(float v) { return v >= 50.0f && v <= 10000.0f; }
static bool validLightVarScale(float v) { return v >= 50.0f && v <= 20000.0f; }
static bool validTempOffset(float v)    { return v >= -15.0f && v <= 15.0f; }

float noiseFullScale() {
  return prefs.getFloat("noiseScale", NOISE_FULL_SCALE_DEFAULT);
}

void setNoiseFullScale(float v) {
  if (!validNoiseScale(v)) return;
  prefs.putFloat("noiseScale", v);
}

float lightLuxScale() {
  return prefs.getFloat("lightLux", LIGHT_LUX_SCALE_DEFAULT);
}

void setLightLuxScale(float v) {
  if (!validLightLuxScale(v)) return;
  prefs.putFloat("lightLux", v);
}

float lightVarScale() {
  return prefs.getFloat("lightVar", LIGHT_VAR_SCALE_DEFAULT);
}

void setLightVarScale(float v) {
  if (!validLightVarScale(v)) return;
  prefs.putFloat("lightVar", v);
}

float tempOffsetC() {
  return prefs.getFloat("tempOff", TEMP_OFFSET_DEFAULT);
}

void setTempOffsetC(float v) {
  if (!validTempOffset(v)) return;
  prefs.putFloat("tempOff", v);
}

void resetSensorCalibration() {
  prefs.putFloat("noiseScale", NOISE_FULL_SCALE_DEFAULT);
  prefs.putFloat("lightLux",   LIGHT_LUX_SCALE_DEFAULT);
  prefs.putFloat("lightVar",   LIGHT_VAR_SCALE_DEFAULT);
  prefs.putFloat("tempOff",    TEMP_OFFSET_DEFAULT);
}

} // namespace Storage
