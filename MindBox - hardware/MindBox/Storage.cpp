#include "Storage.h"
#include "config.h"
#include <Preferences.h>
#include <time.h>

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

static void migrateDurations() {
  if (prefs.isKey("workDur")) return;
  int legacy = prefs.getInt("lastDur", DUR_DEFAULT_MIN);
  prefs.putInt("workDur", legacy);
  prefs.putInt("breakDur", 5);
}

namespace Storage {

void begin() {
  prefs.begin("mindbox", false);
  if (prefs.getString("devId", "").length() == 0) prefs.putString("devId", makeId());
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
void setPaired(bool p) { prefs.putBool("paired", p); }

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

#pragma pack(push, 1)
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
};
#pragma pack(pop)

static const uint16_t CK_MAGIC = 0x4D42;
static const uint8_t  CK_VER   = 2;

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
  prefs.putBytes("ckpt", &s, sizeof(s));
  prefs.putBool("ckActive", true);
}

bool loadCheckpoint(SessionCheckpoint& cp) {
  if (!prefs.getBool("ckActive", false)) return false;
  StoredCheckpoint s;
  if (prefs.getBytes("ckpt", &s, sizeof(s)) != sizeof(s)) return false;
  if (s.magic != CK_MAGIC) return false;
  if (s.version != CK_VER && s.version != 1) return false;
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
  return true;
}

void clearCheckpoint() { prefs.putBool("ckActive", false); }
bool hasCheckpoint()   { return prefs.getBool("ckActive", false); }

} // namespace Storage
