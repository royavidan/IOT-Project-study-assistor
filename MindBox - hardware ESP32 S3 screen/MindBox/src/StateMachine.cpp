#include "StateMachine.h"
#include "config.h"
#include "Inputs.h"
#include "Sensors.h"
#include "Session.h"
#include "Display.h"
#include "TimerScreen.h"
#include "Keyboard.h"
#include "Panel.h"
#include "Haptics.h"
#include "Sound.h"
#include "Theme.h"
#include "Audio.h"
#include "LedRing.h"
#include "Storage.h"
#include "Cloud.h"
#include "UploadQueue.h"
#include "Menu.h"
#include "Payload.h"
#include <ESP.h>
#include <math.h>

static SysState     s_state = ST_BOOTING;
static Mode         s_mode  = MODE_WORK;
static int          s_workDur  = DUR_DEFAULT_MIN;
static int          s_breakDur = 5;
static int          s_cycleCount = CYCLE_DEFAULT;
static DeviceConfig s_cfg   = defaultConfig();
static uint32_t     s_stateAt = 0, s_lastRender = 0, s_bootAt = 0;
static uint32_t     s_lastCheckpoint = 0;
static uint32_t     s_lastSnap = 0;
static unsigned long s_signOutGuardUntil = 0;  // ignore stale paired:true until this millis()
static uint32_t     s_lastPairConfigPoll = 0;
static uint32_t     s_lastIdleConfigPoll = 0;
static bool         s_uiDirty = true;
static String       s_devShort;
static char         s_pairCode[7] = {0};

static bool         s_pendingCycleOffer = false;
static bool         s_pendingSetComplete = false;
static Mode         s_cycleNextMode = MODE_BREAK;
static int          s_cycleNextMin = 5;
static SessionCheckpoint s_resumeCp = {};
static SessionRecord s_lastRec = {};   // last finished session — feeds the DONE summary

static uint8_t  s_curInterf     = INTERF_NONE;  // live environment interference
static uint8_t  s_sessionWorst  = INTERF_NONE;  // most recent interference this session
static uint32_t s_interfSince   = 0;            // when the current interference began
static bool     s_interfNudged  = false;        // already buzzed for this episode
static const uint32_t INTERF_NUDGE_MS = 30000;  // persist this long -> nudge
static uint32_t s_lastInterfChime = 0;          // last Sound::alert(); 0 = none this session
static const uint32_t INTERF_ALERT_GAP_MS = 180000;  // alert chime at most every 3 min per session

// Site agenda day-cache — refreshed on every config poll while paired. Times are
// OWNER-local (CloudSettings.tzOffsetMin), NOT the box TZ: the site schedules in
// the account owner's timezone and the box just follows.
static AgendaItem s_agenda[AGENDA_MAX_ITEMS];
static uint8_t    s_agendaCount = 0;
static int16_t    s_tzOffsetMin = 0;
static bool       s_autoStartEnabled = false;

// Rest-of-week cache (weekStr, days 1..6 ahead) + the ST_AGENDA day pager
// index (0 = today from agenda[], 1..6 = week[] filtered by dayOffset).
static WeekItem   s_week[WEEK_MAX_ITEMS];
static uint8_t    s_weekCount = 0;
static uint8_t    s_agendaDay = 0;
static const uint8_t AGENDA_MAX_DAY = 6;
static const uint8_t AGENDA_DAY_ROWS = 10;   // server cap: <=10 blocks per day

// Exam mode (site DND) — RAM only, re-applied on every config poll while paired.
static bool       s_examMode = false;

// Remote message splash (ST_MESSAGE) + a 1-slot hold for a message that arrives
// mid-session (newest wins; shown when the box next returns to idle).
static const uint32_t MESSAGE_SPLASH_MS = 30000;
static char       s_msgTitle[16] = {0};
static char       s_msgBody[48]  = {0};
static char       s_pendingMsg[48] = {0};

// Homework quick-update (ST_HOMEWORK): cloud cache of the top pending items +
// the row cursor (== count selects the Skip row). 20s idle timeout.
static const uint32_t HOMEWORK_TIMEOUT_MS = 20000;
static HwItem     s_hw[HW_MAX_ITEMS];
static uint8_t    s_hwCount = 0;
static int        s_hwCursor = 0;

// Scheduled auto-start: splash payload + per-day dedupe. A block is "handled"
// (won't retrigger today) the moment its splash is raised — start AND cancel
// both count. Key = the block's startMin within the owner-local day ordinal.
static const uint32_t AUTOSTART_SPLASH_MS = 10000;
static char       s_autoTitle[24] = {0};
static int        s_autoDurMin = DUR_DEFAULT_MIN;
static uint16_t   s_autoHandled[AGENDA_MAX_ITEMS];
static uint8_t    s_autoHandledN = 0;
static uint32_t   s_autoHandledDay = 0;

#if USE_TOUCH
// On-device Wi-Fi setup sub-flow (ST_WIFI_SETUP).
enum { WSTEP_SCAN, WSTEP_SSID, WSTEP_PASS, WSTEP_CONNECT, WSTEP_PORTAL };
static uint8_t  s_wifiStep      = WSTEP_SCAN;
static int      s_wifiCursor    = 0, s_wifiScroll = 0;
static char     s_wifiSsid[33]  = {0};
static uint32_t s_wifiConnectAt = 0;
#endif

// Raising the SoftAP setup portal is async (handed to the core-0 net task), so the
// AP is NOT live the instant we ask. Track the request time + whether we've seen it
// up, so the portal screen waits for the AP instead of snapping back to the menu on
// the first "not active yet" tick — the bug that made "Use phone" look like a crash.
static uint32_t       s_portalReqAt  = 0;
static bool           s_portalSeenUp = false;
static const uint32_t PORTAL_START_GRACE_MS = 6000UL;

static bool         s_setActive = false;
static int          s_setCycleTotal = CYCLE_DEFAULT;
static int          s_setFocusDone = 0;

static PauseReason  s_pauseReason = PAUSE_MANUAL;
static bool         s_pausedOverlay = false;   // paused: options menu open vs bare timer
static uint32_t     s_lastCoachAt = 0;
static int          s_lastDispSec = -1;
static bool         s_lastCoachUi = false;

static void publishTelemetry();   // forward decl (defined after buildModel)

static bool runningScreenChanged() {
  int sec = Session::remainingSec();
  bool coach = s_cfg.adaptiveCoaching && s_cfg.coachingNudgeScreen
               && s_mode == MODE_WORK
               && Session::lastFle() > FLE_ADAPTIVE_BREAK;
  bool changed = sec != s_lastDispSec || coach != s_lastCoachUi;
  s_lastDispSec = sec;
  s_lastCoachUi = coach;
  return changed;
}

static unsigned long renderPeriodMs() {
  return 200;
}

static bool shouldRender(uint32_t now) {
  if (s_uiDirty) return true;
  // Running timer: redraw only when runningScreenChanged marks dirty (1 Hz).
  if (s_state == ST_RUNNING && !Menu::runningActive()) return false;
  return now - s_lastRender > renderPeriodMs();
}

static int activeDur() {
  return s_mode == MODE_WORK ? s_workDur : s_breakDur;
}

static void enter(SysState s) {
  s_state = s;
  s_stateAt = millis();
  s_uiDirty = true;
  if (s == ST_IDLE) Menu::resetToRoot();
  if (s == ST_PAUSED) Menu::pausedReset(s_pauseReason);
  publishTelemetry();       // refresh the live snapshot...
  Cloud::flagTransition();  // ...and push it immediately (state changed)
}

static void enterPaused(PauseReason reason) {
  s_pauseReason = reason;
#if USE_TOUCH
  s_pausedOverlay = false;   // touch: paused always shows the bare timer; ANY tap resumes (see ST_PAUSED)
#else
  s_pausedOverlay = true;    // no-touch: straight to the Resume/End menu (unchanged)
#endif
  Session::pauseClock();
  enter(ST_PAUSED);
}

static float fracRemaining() {
  int t = Session::targetSec();
  return t > 0 ? (float)Session::remainingSec() / t : 0;
}

static UiModel buildModel() {
  UiModel m;
  m.state          = s_state;
  m.mode           = s_mode;
  m.durationMin    = activeDur();
  m.showTimer      = s_cfg.showTimer;
  m.remainingSec   = Session::remainingSec();
  m.targetSec      = Session::targetSec();
  m.actualFocusMin = Session::actualFocusMin();
  m.sessionBreaks  = Session::breaks();
  m.sessionPresInt = Session::presenceInterruptions();
  m.setActive      = s_setActive;
  m.setComplete    = s_pendingSetComplete && s_state == ST_COMPLETE;
  m.setFocusDone   = s_setFocusDone;
  m.setCycleTotal  = s_setCycleTotal;
  m.coachingNudge  = s_cfg.adaptiveCoaching && s_cfg.coachingNudgeScreen
                     && s_mode == MODE_WORK
                     && Session::lastFle() > FLE_ADAPTIVE_BREAK;
  m.coachingFle    = Session::lastFle();
  m.interference   = (s_state == ST_RUNNING || s_state == ST_PAUSED) ? s_curInterf : INTERF_NONE;
  m.sessionInterf  = s_sessionWorst;
  // COMPLETE summary stats come from the just-finished record (set in persistSession).
  m.sessionFocusLoad = s_lastRec.focusLoadAvg;
  m.sessionNoisePct  = HAS_ANY_MIC ? (int)lroundf(s_lastRec.noiseAvg * 100.0f) : -1;
  m.sessionTempC     = s_lastRec.tempC;
#if HAS_TEMP
  m.sessionTempHot   = !isnan(s_lastRec.tempC) &&
                       (s_lastRec.tempC > s_cfg.tempMaxC || s_lastRec.tempC < s_cfg.tempMinC);
#else
  m.sessionTempHot   = false;
#endif
  m.pauseReason    = s_pauseReason;
  m.wifi           = Cloud::online();
  m.present        = Sensors::present();
  // Live env-status icons (running screen): light when the condition is active right now.
#if HAS_PRESENCE
  m.envAway = !m.present;
#else
  m.envAway = false;
#endif
#if HAS_ANY_MIC
  m.envLoud = (int)lroundf(Sensors::noiseDb()) > s_cfg.noiseMaxDb;
#else
  m.envLoud = false;
#endif
#if HAS_TEMP
  { float c; m.envHot = Sensors::readTemp(c) && (c > s_cfg.tempMaxC || c < s_cfg.tempMinC); }
#else
  m.envHot = false;
#endif
#if HAS_LIGHT
  { float lux, var;
    m.envDim = Sensors::readLight(lux, var) &&
               (lux < s_cfg.lightMinLux || lux > s_cfg.lightMaxLux); }
#else
  m.envDim = false;
#endif
  m.paired         = Storage::paired();
  m.deviceId       = s_devShort.c_str();
  m.pairCode       = s_pairCode;
  Cloud::localTimeHHMM(m.clockStr, sizeof(m.clockStr));   // "HH:MM" when online, else ""
  return m;
}

// Hand the current live state to the core-0 net task (live mirror → app).
static void publishTelemetry() {
  TelemetrySnap t = {};
  t.state        = (uint8_t)s_state;
  t.mode         = (uint8_t)s_mode;
  t.remainingSec = Session::remainingSec();
  t.fle          = Session::lastFle();
  t.setActive    = s_setActive;
  t.setIndex     = (uint8_t)s_setFocusDone;
  t.setTotal     = (uint8_t)s_setCycleTotal;
  t.pauseReason  = (uint8_t)s_pauseReason;
  int b = Sensors::batteryPct();
  t.batteryPct   = b < 0 ? 100 : b;
  String h = Sensors::healthJson();
  strncpy(t.health, h.c_str(), sizeof(t.health) - 1);
  // Env readings for the telemetry uplink — sentinels first, then only the
  // wired-and-valid sensors overwrite them (the net task never calls Sensors).
  t.tempC = NAN; t.humidityPct = -1; t.lightLux = -1; t.noiseDb = -1;
#if HAS_TEMP
  { float c;  if (Sensors::readTemp(c))       t.tempC = c; }
  { float hp; if (Sensors::readHumidity(hp))  t.humidityPct = (int16_t)lroundf(hp); }
#endif
#if HAS_LIGHT
  { float lux, var; if (Sensors::readLight(lux, var)) t.lightLux = (int32_t)lroundf(lux); }
#endif
#if HAS_ANY_MIC
  if (Sensors::health().micOk) t.noiseDb = (int16_t)lroundf(Sensors::noiseDb());
#endif
  Cloud::publishState(t);
}

static void saveCheckpointNow() {
  if (s_state != ST_RUNNING && s_state != ST_PAUSED) return;
  SessionCheckpoint cp = Session::snapshot(s_state);
  cp.setCycleTotal = (uint8_t)s_setCycleTotal;
  cp.setFocusDone  = (uint8_t)s_setFocusDone;
  cp.setActive     = s_setActive ? 1 : 0;
  Storage::saveCheckpoint(cp);
  s_lastCheckpoint = millis();
}

static bool persistSession(const char* status) {
  time_t endE = Cloud::haveClock() ? Cloud::nowEpoch() : 0;
  uint32_t seq = Storage::nextSeq();
  const int sampleN = Session::sampleCount();
  SessionRecord r = Session::finish(status, endE, seq);
  s_lastRec = r;   // keep aggregates for the DONE summary screen
  // One JSON build — queue first (LittleFS), then NVS stats (single heap peak).
  String json = Payload::sessionJson(r, Session::samples(), sampleN,
                                       Storage::deviceId().c_str());
  UploadQueue::enqueueJson(seq, json);
  json = String();   // release heap before NVS writes
  Cloud::kickUpload();
  bool goalHit = Storage::bufferSession(r);
  if (r.mode == MODE_WORK) Storage::bumpServerTodaySec((uint32_t)r.actualFocusSec);
  Storage::setLiveFocusSec(0);
  Storage::setWorkDuration(s_workDur);
  Storage::setBreakDuration(s_breakDur);
  Storage::clearCheckpoint();
  Serial.printf("[session] %s focus=%ds samples=%d heap=%u pending=%d\n",
                status, r.actualFocusSec, sampleN, ESP.getFreeHeap(),
                UploadQueue::pendingCount());
  Cloud::kickUpload();
  return goalHit;
}

static void enterPairing() {
  snprintf(s_pairCode, sizeof(s_pairCode), "%06u", (unsigned)(esp_random() % 1000000u));
  Cloud::publishPairingCode(s_pairCode);
  s_lastPairConfigPoll = millis();
  Cloud::requestConfigSync();
  enter(ST_PAIRING);
}

// Box-side sign-out: release the account on the server AND drop it locally, so
// the box stops syncing to that account and the /device card clears. The guard
// window prevents an in-flight config fetch from re-pairing us before the
// server-side unpair lands.
static void signOutAccount() {
  Cloud::requestUnpair();                 // task POSTs /ingest/unpair -> owner=null
  Storage::setPaired(false);
  Storage::clearOwnerAccount();
  Storage::setServerTodaySec(0);
  s_agendaCount = 0;                      // agenda/auto-start are account data
  s_weekCount = 0;
  s_autoStartEnabled = false;
  s_examMode = false;                     // exam/homework/stats are account data too
  Sound::setDnd(false);
  s_hwCount = 0;
  Menu::setExamInfo(-1, "");
  Menu::setCloudStats(-1, -1);
  Sound::setChimeMask(0xFF);              // back to local-only sound control
  s_signOutGuardUntil = millis() + SIGN_OUT_GUARD_MS;
  if (s_cfg.hapticsEnabled) Haptics::reset();
  Menu::setContext(Cloud::online(), false, s_devShort.c_str());
  Menu::invalidate();
  Menu::resetToRoot();
  s_uiDirty = true;
  Serial.println("[device] signed out from the box");
}

static void clearSet() {
  s_setActive = false;
  s_setFocusDone = 0;
}

static void startSet() {
  s_setActive = true;
  s_setFocusDone = 0;
  s_setCycleTotal = s_cycleCount;
}

static unsigned long sessionSamplePeriodMs() {
  if (s_mode == MODE_BREAK) return SAMPLE_PERIOD_BREAK_MS;
  if (s_cfg.adaptiveCoaching) return SAMPLE_PERIOD_COACHING_MS;
  return SAMPLE_PERIOD_MS;
}

static bool s_wasAway = false;   // edge tracker: an away event is counted once per present->away transition

static void startSessionMode(Mode m, int durMin) {
  s_mode = m;
  s_lastCoachAt = 0;
  s_lastDispSec = -1;
  s_lastCoachUi = false;
  s_curInterf = INTERF_NONE;
  s_sessionWorst = INTERF_NONE;
  s_interfNudged = false;
  s_lastInterfChime = 0;   // fresh rate-limit window for the alert chime
  s_wasAway = false;
  time_t st = Cloud::haveClock() ? Cloud::nowEpoch() : 0;
  Session::start(m, durMin, st);
  Session::setSamplePeriodMs(sessionSamplePeriodMs());
  saveCheckpointNow();
  Haptics::tap();
  Sound::start();
  enter(ST_RUNNING);
}

static void startSession() {
  startSet();
  startSessionMode(MODE_WORK, s_workDur);
}

// Restart the current focus/break to full time without advancing cycle counters
// (re-runs Session::start for the same mode/duration and re-enters ST_RUNNING).
static void restartCurrentInterval() {
  startSessionMode(s_mode, activeDur());
}

// Evaluate live environment interference vs comfort thresholds. Only sensors that
// are wired (HAS_*) AND enabled (alert*) can fire. Priority: away > noise > temp > light.
static uint8_t currentInterference() {
#if HAS_PRESENCE
  if (s_cfg.alertPresence && !Sensors::present()) return INTERF_AWAY;
#endif
#if HAS_ANY_MIC
  if (s_cfg.alertNoise && (int)lroundf(Sensors::noiseDb()) > s_cfg.noiseMaxDb)
    return INTERF_NOISE_HIGH;
#endif
#if HAS_TEMP
  if (s_cfg.alertTemp) {
    float c;
    if (Sensors::readTemp(c)) {
      if (c > s_cfg.tempMaxC) return INTERF_TEMP_HIGH;
      if (c < s_cfg.tempMinC) return INTERF_TEMP_LOW;
    }
  }
#endif
#if HAS_LIGHT
  if (s_cfg.alertLight) {
    float lux, var;
    if (Sensors::readLight(lux, var)) {
      if (lux > s_cfg.lightMaxLux) return INTERF_LIGHT_HIGH;
      if (lux < s_cfg.lightMinLux) return INTERF_LIGHT_LOW;
    }
  }
#endif
  return INTERF_NONE;
}

// True during the configured quiet-hours window (needs a synced wall clock).
static bool inQuietHours() {
  if (s_cfg.quietStartMin == 0xFFFF || s_cfg.quietEndMin == 0xFFFF) return false;
  time_t ep = Cloud::nowEpoch();
  if (ep <= 0) return false;
  struct tm lt; localtime_r(&ep, &lt);
  int mins = lt.tm_hour * 60 + lt.tm_min;
  int s = s_cfg.quietStartMin, e = s_cfg.quietEndMin;
  if (s == e) return false;
  return (s < e) ? (mins >= s && mins < e) : (mins >= s || mins < e);  // handle wrap
}

// Box-local UTC offset (seconds) at epoch ep, from the TZ set at NTP init (same
// source as the header clock's localtime_r) via the field-difference of local vs
// UTC broken-down time — portable on this newlib (no tm_gmtoff / timegm). Used
// as the agenda fallback when the server's tzOffsetMin is 0.
static long boxLocalOffsetSec(time_t ep) {
  struct tm g, l;
  gmtime_r(&ep, &g);
  localtime_r(&ep, &l);
  int dd = l.tm_yday - g.tm_yday;            // 0 or +/-1, or +/-365 at a year edge
  if (dd > 1) dd = -1; else if (dd < -1) dd = 1;   // year-boundary wrap correction
  return (((long)dd * 24 + (l.tm_hour - g.tm_hour)) * 60
          + (l.tm_min - g.tm_min)) * 60 + (l.tm_sec - g.tm_sec);
}

// Header label for an ST_AGENDA page: "TODAY", or weekday + date for a paged
// day ("Sun 20/7"), from the tz-shifted epoch via gmtime_r so the fields are
// the OWNER's calendar. gmtime's tm_wday (0 = Sunday) agrees with the epoch-day
// formula ((epochDays % 7) + 4) % 7 on a Sun..Sat table: 1970-01-01 (day 0)
// was a Thursday, and (0 + 4) % 7 = 4 -> "Thu". Falls back to "+Nd" before NTP.
static void agendaDayLabel(char* out, size_t n) {
  if (s_agendaDay == 0) {
    strncpy(out, "TODAY", n - 1);
    out[n - 1] = 0;
    return;
  }
  static const char* DOW[7] = { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" };
  time_t ep = Cloud::nowEpoch();
  if (ep <= 0) {
    snprintf(out, n, "+%dd", (int)s_agendaDay);
    return;
  }
  // Owner offset from the server; when it's absent/zero, fall back to the box's
  // TZ-correct local offset (same path as the header clock) so a missing server
  // offset doesn't render UTC (3h behind in Israel summer).
  int64_t offSec = (int64_t)s_tzOffsetMin * 60;
  if (s_tzOffsetMin == 0) offSec = boxLocalOffsetSec(ep);
  time_t shifted = ep + (time_t)offSec + (time_t)s_agendaDay * 86400;
  struct tm t;
  gmtime_r(&shifted, &t);   // gmtime on the shifted epoch = owner-local calendar
  snprintf(out, n, "%s %d/%d", DOW[t.tm_wday], t.tm_mday, t.tm_mon + 1);
}

// Owner-local wall clock from the NTP epoch + the site's tzOffsetMin (NOT the
// box TZ — agenda minutes are in the account owner's timezone). False until NTP.
static bool ownerLocalNow(int& minOfDay, uint32_t& dayKey) {
  if (!Cloud::haveClock()) return false;
  time_t ep = Cloud::nowEpoch();
  if (ep <= 0) return false;
  // When the server offset is absent/zero, fall back to the box's TZ-correct
  // local offset (header-clock path) so we don't treat epoch as UTC in Israel.
  int64_t offSec = (int64_t)s_tzOffsetMin * 60;
  if (s_tzOffsetMin == 0) offSec = boxLocalOffsetSec(ep);
  int64_t local = (int64_t)ep + offSec;
  if (local < 0) local = 0;
  dayKey   = (uint32_t)(local / 86400);
  minOfDay = (int)((local % 86400) / 60);
  return true;
}

// Scheduled auto-start (checked only from ST_IDLE): a STUDY agenda block whose
// startMin matches owner-local now (±1 min) raises the cancellable 10 s splash,
// then starts a WORK session of the block's length. chimeMask bit2 gates only
// the splash CHIME (inside Sound::autoStart); the start itself is gated by the
// server's autoStartEnabled. In quiet hours the chime is already muted by the
// quiet-hours Sound gate, but the session still auto-starts SILENTLY — a
// scheduled block is the user's own plan, not a notification to suppress.
static bool tickScheduledStart() {
  if (!s_autoStartEnabled || s_agendaCount == 0 || !Storage::paired()) return false;
  int nowMin; uint32_t day;
  if (!ownerLocalNow(nowMin, day)) return false;
  if (day != s_autoHandledDay) { s_autoHandledDay = day; s_autoHandledN = 0; }
  for (uint8_t i = 0; i < s_agendaCount; i++) {
    const AgendaItem& it = s_agenda[i];
    if (it.kind != AGENDA_STUDY) continue;
    int d = nowMin - (int)it.startMin;
    if (d < -1 || d > 1) continue;
    bool handled = false;
    for (uint8_t h = 0; h < s_autoHandledN; h++)
      if (s_autoHandled[h] == it.startMin) { handled = true; break; }
    if (handled) continue;
    if (s_autoHandledN < AGENDA_MAX_ITEMS) s_autoHandled[s_autoHandledN++] = it.startMin;
    int dur = (int)it.endMin - (int)it.startMin;
    if (dur < 10)  dur = 10;    // sane session bounds, whatever the block says
    if (dur > 180) dur = 180;
    s_autoDurMin = dur;
    strncpy(s_autoTitle, it.title, sizeof(s_autoTitle) - 1);
    s_autoTitle[sizeof(s_autoTitle) - 1] = 0;
    Sound::autoStart();          // bit2 + enabled/quiet gating live inside Sound
    enter(ST_AUTOSTART);
    Serial.printf("[sched] auto-start splash: '%s' %dm (block %02d:%02d)\n",
                  s_autoTitle, s_autoDurMin, it.startMin / 60, it.startMin % 60);
    return true;
  }
  return false;
}

static void scheduleCycleOffer(Mode completedMode) {
  s_pendingCycleOffer = true;
  s_pendingSetComplete = false;
  if (completedMode == MODE_WORK) {
    s_cycleNextMode = MODE_BREAK;
    // Long break after every N completed focus blocks (s_setFocusDone already bumped).
    // Set-scoped: outside a set s_setFocusDone is stuck at 0 and 0 % N == 0 would
    // turn EVERY standalone break into the long one.
    bool longBreak = s_setActive && s_cfg.longBreakEnabled && s_cfg.longBreakEvery > 0 &&
                     (s_setFocusDone % s_cfg.longBreakEvery == 0);
    s_cycleNextMin = longBreak ? s_cfg.longBreakMin : s_breakDur;
  } else {
    s_cycleNextMode = MODE_WORK;
    s_cycleNextMin  = s_workDur;
  }
}

static void updateTodayLiveFocus() {
  static uint32_t last = 0;
  if (millis() - last < 1000) return;   // throttle: this hits NVS, was running ~200x/s
  last = millis();
  Storage::syncDayBoundary();
  uint32_t live = 0;
  if (s_state == ST_RUNNING || s_state == ST_PAUSED) {
    if (s_mode == MODE_WORK) live = (uint32_t)Session::actualFocusSec();
  } else if (s_state == ST_RESUME && s_resumeCp.mode == MODE_WORK) {
    live = s_resumeCp.actualMs / 1000UL;
  } else if (Storage::hasCheckpoint()) {
    SessionCheckpoint cp;
    if (Storage::loadCheckpoint(cp) && cp.mode == MODE_WORK)
      live = cp.actualMs / 1000UL;
  }
  Menu::setLiveFocusSec(live);
}

static void beginEnd(const char* status) {
  bool goalHit = persistSession(status);
  s_pendingCycleOffer = false;
  s_pendingSetComplete = false;
  clearSet();
  if (goalHit && s_cfg.hapticsEnabled) Haptics::complete();
  else Haptics::reset();
  if (goalHit) Sound::complete();
  enter(ST_COMPLETE);
}

static void onTimerComplete() {
  Mode completed = s_mode;
  (void)persistSession("completed");

  if (s_setActive && completed == MODE_WORK) {
    s_setFocusDone++;
    if (s_setFocusDone >= s_setCycleTotal &&
        !(s_cfg.longBreakEnabled && s_cfg.longBreakMin > 0)) {
      // Long break disabled: the set ends right after the last focus block (old behaviour).
      clearSet();
      s_pendingCycleOffer = false;
      s_pendingSetComplete = true;
      Storage::recordSetComplete();
      Haptics::complete();
      Sound::complete();
      enter(ST_COMPLETE);
      return;
    }
    // Not the last block -> offer the short break. LAST block -> the set is NOT closed
    // yet: scheduleCycleOffer picks the LONG break (focusDone % longBreakEvery == 0) and
    // the set completes when that final break finishes (below) or is skipped
    // (MENU_SKIP_CYCLE). Closing the set here is why the site's long break never fired.
    scheduleCycleOffer(MODE_WORK);
  } else if (s_setActive && completed == MODE_BREAK) {
    if (s_setFocusDone < s_setCycleTotal)
      scheduleCycleOffer(MODE_BREAK);
    else {
      // Final (long) break done -> NOW the whole set is complete: celebrate.
      clearSet();
      s_pendingCycleOffer = false;
      s_pendingSetComplete = true;
      Storage::recordSetComplete();
    }
  } else {
    scheduleCycleOffer(completed);
  }

  if (s_cfg.hapticsEnabled) Haptics::complete();
  Sound::complete();
  enter(ST_COMPLETE);
}

static void resumeFromCheckpoint() {
  Session::restore(s_resumeCp);
  Session::alignSampleTimer();
  s_mode = s_resumeCp.mode;
  s_setActive = s_resumeCp.setActive != 0;
  s_setCycleTotal = s_resumeCp.setCycleTotal > 0 ? s_resumeCp.setCycleTotal : s_cycleCount;
  s_setFocusDone = s_resumeCp.setFocusDone;
  s_lastCheckpoint = millis();
  if (s_resumeCp.sysState == ST_PAUSED) {
    s_pauseReason = PAUSE_MANUAL;
    Haptics::pause();
    enter(ST_PAUSED);
  } else {
    Session::resumeClock();
    Haptics::resume();
    enter(ST_RUNNING);
  }
}

static void discardCheckpoint() {
  Session::restore(s_resumeCp);
  s_mode = s_resumeCp.mode;
  s_setActive = s_resumeCp.setActive != 0;
  s_setCycleTotal = s_resumeCp.setCycleTotal > 0 ? s_resumeCp.setCycleTotal : s_cycleCount;
  s_setFocusDone = s_resumeCp.setFocusDone;
  bool goalHit = persistSession("interrupted");
  clearSet();
  if (goalHit && s_cfg.hapticsEnabled) Haptics::complete();
  else Haptics::reset();
  enter(ST_IDLE);
}

static void tickAdaptiveCoaching(uint32_t now) {
  if (s_examMode) return;   // exam DND: no coaching nudges/auto-pause
  if (!s_cfg.adaptiveCoaching || s_mode != MODE_WORK) return;
  if (Session::lastFle() <= FLE_ADAPTIVE_BREAK) return;
  if (now - s_lastCoachAt < COACHING_COOLDOWN_MS) return;

  bool acted = false;
  if (s_cfg.coachingNudgeHaptic && s_cfg.hapticsEnabled) {
    Haptics::pause();
    acted = true;
  }
  if (s_cfg.coachingAutoPause) {
    saveCheckpointNow();
    enterPaused(PAUSE_COACHING);
    acted = true;
  }
  if (acted)
    s_lastCoachAt = now;
}

// "Idle-ish": no session in flight — the states a remote START may take over
// (mirrors the scheduled auto-start's ST_IDLE gate, widened to the other
// between-session screens; taking over COMPLETE/CYCLE_OFFER is deliberate).
static bool idleLike() {
  return s_state == ST_IDLE || s_state == ST_COMPLETE || s_state == ST_AGENDA ||
         s_state == ST_CYCLE_OFFER || s_state == ST_MESSAGE || s_state == ST_HOMEWORK;
}

// Stricter gate for the message/ring SPLASH: never trample the post-interval
// flow (COMPLETE's auto-advance / the NEXT prompt) — those hold the pomodoro
// chain. A message that can't show now waits in the 1-slot pending buffer.
static bool msgIdle() {
  return s_state == ST_IDLE || s_state == ST_AGENDA ||
         s_state == ST_MESSAGE || s_state == ST_HOMEWORK;
}

static void enterMessage(const char* title, const char* body) {
  strncpy(s_msgTitle, title ? title : "", sizeof(s_msgTitle) - 1);
  s_msgTitle[sizeof(s_msgTitle) - 1] = 0;
  strncpy(s_msgBody, body ? body : "", sizeof(s_msgBody) - 1);
  s_msgBody[sizeof(s_msgBody) - 1] = 0;
  enter(ST_MESSAGE);
}

// Remote commands from the app (Cloud cmd queue). A command that doesn't fit the
// current state is IGNORED (logged) — the box never interrupts a running session
// except for the explicit CMD_END.
static void handleRemoteCmd(const RemoteCmd& rc) {
  switch (rc.type) {
    case CMD_START:
      if (idleLike()) {
        s_pendingCycleOffer = false;
        s_pendingSetComplete = false;
        if (rc.durationMin == 0) {
          // arg 0 => run the FULL configured session (multi-block set + breaks +
          // long break), the same entry the menu "Start" uses.
          Serial.println("[cmd] remote start (full session)");
          startSession();
        } else {
          clearSet();   // a one-off single interval, like a scheduled block
          Serial.printf("[cmd] remote start %um\n", (unsigned)rc.durationMin);
          startSessionMode(MODE_WORK, rc.durationMin);   // normal start chime path
        }
      } else {
        Serial.println("[cmd] start ignored (session active)");
      }
      break;
    case CMD_END:
      if (s_state == ST_RUNNING || s_state == ST_PAUSED) {
        Serial.println("[cmd] remote end");
        Menu::runningDismiss();          // same path as the menu End action
        beginEnd("interrupted");
      } else {
        Serial.println("[cmd] end ignored (no session)");
      }
      break;
    case CMD_RING:
      Sound::ring();                     // ALWAYS — find-my bypasses every gate
      if (msgIdle()) enterMessage("Ring!", "Your MindBox is here");
      break;                             // never disturbs a running session's state
    case CMD_MESSAGE:
      Sound::alert();                    // chimeMask bit3 + quiet hours + exam DND gated
      if (msgIdle()) {
        enterMessage("Message", rc.text);
      } else {                           // hold for after the session (newest wins)
        strncpy(s_pendingMsg, rc.text, sizeof(s_pendingMsg) - 1);
        s_pendingMsg[sizeof(s_pendingMsg) - 1] = 0;
      }
      break;
    default:                             // CMD_PAUSE/CMD_RESUME not exposed by the site (yet)
      Serial.printf("[cmd] type %u ignored\n", (unsigned)rc.type);
      break;
  }
}

#if USE_TOUCH
static void wifiStartFlow();   // defined below (used here by handleMenuAction)
#endif

static void handleMenuAction(MenuAction a) {
  switch (a) {
    case MENU_START_SESSION:  startSession(); break;
    case MENU_ENTER_PAIRING:  enterPairing(); break;
    case MENU_SIGN_OUT:       signOutAccount(); break;
    case MENU_ENTER_DIAGNOSTICS: enter(ST_DIAG); break;
    case MENU_ENTER_AGENDA:   s_agendaDay = 0; enter(ST_AGENDA); break;   // pager opens on today
#if USE_TOUCH
    case MENU_ENTER_WIFI_SETUP: wifiStartFlow(); break;   // on-device scan + keyboard
#else
    case MENU_ENTER_WIFI_SETUP:
      s_portalReqAt = millis(); s_portalSeenUp = false;
      Cloud::startWifiPortal(); enter(ST_WIFI_SETUP); break;
#endif
    case MENU_RESUME_SESSION:
      Session::resumeClock();
      saveCheckpointNow();
      Haptics::resume();
      Sound::resume();
      enter(ST_RUNNING);
      break;
    case MENU_END_SESSION:
      Menu::runningDismiss();         // close the SESSION overlay before leaving the running state
      beginEnd("interrupted");
      break;
    case MENU_SKIP_INTERVAL:
      Menu::runningDismiss();         // close the overlay so the NEXT interval shows the timer, not the menu
      Session::pauseClock();          // freeze elapsed (already paused via the menu; idempotent)
      onTimerComplete();              // credits ACTUAL focus, advances to the next interval
      break;
    case MENU_ADD_TIME:
      Session::addTime(300);          // +5 min to the current interval
      Menu::runningDismiss();
      saveCheckpointNow();
      Haptics::tap();
      s_uiDirty = true;
      break;
    case MENU_SYNC_NOW:
      Cloud::requestConfigSync();
      Cloud::kickUpload();
      Haptics::tap();
      break;
    case MENU_FACTORY_RESET:
      Storage::factoryReset();
      delay(120);
      ESP.restart();
      break;
    case MENU_PAUSE_SESSION:
      Session::addBreak();
      Haptics::pause();
      Sound::pause();
      Menu::runningDismiss();
      saveCheckpointNow();
      enterPaused(PAUSE_MANUAL);
      break;
    case MENU_RESUME_CHECKPOINT:
      resumeFromCheckpoint();
      break;
    case MENU_DISCARD_CHECKPOINT:
      discardCheckpoint();
      break;
    case MENU_START_CYCLE:
      startSessionMode(s_cycleNextMode, s_cycleNextMin);
      break;
    case MENU_SKIP_CYCLE:
      // Declining the offer after the LAST focus block still completes the set —
      // all focus blocks are done; only the trailing long break was skipped.
      if (s_setActive && s_setFocusDone >= s_setCycleTotal) Storage::recordSetComplete();
      clearSet();
      enter(ST_IDLE);
      break;
    default: break;
  }
}

#if USE_TOUCH
// --- on-device Wi-Fi setup helpers ------------------------------------------
static int wifiTotalRows() { return Cloud::scanCount() + 2; }  // + Rescan, Use phone

static void wifiClampCursor() {
  int total = wifiTotalRows();
  if (s_wifiCursor < 0) s_wifiCursor = total - 1;
  if (s_wifiCursor >= total) s_wifiCursor = 0;
  if (s_wifiCursor < s_wifiScroll) s_wifiScroll = s_wifiCursor;
  if (s_wifiCursor >= s_wifiScroll + MENU_VISIBLE_ROWS)
    s_wifiScroll = s_wifiCursor - MENU_VISIBLE_ROWS + 1;
}

static const MenuView& wifiScanView() {
  static MenuView v;
  memset(&v, 0, sizeof(v));
  strncpy(v.title, "WI-FI", sizeof(v.title) - 1);
  strncpy(v.statusWord, "2.4GHz", sizeof(v.statusWord) - 1);
  int sc = Cloud::scanCount(), total = sc + 2;
  wifiClampCursor();
  v.rowCount = 0;
  for (int i = 0; i < MENU_VISIBLE_ROWS; i++) {
    int idx = s_wifiScroll + i;
    if (idx >= total) break;
    MenuRow& r = v.rows[v.rowCount++];
    bool sel = (idx == s_wifiCursor);
    if (idx < sc) {
      char ss[33]; int rssi = 0; bool sec = false;
      Cloud::scanResult(idx, ss, sizeof(ss), rssi, sec);
      strncpy(r.label, ss, sizeof(r.label) - 1); r.label[sizeof(r.label) - 1] = 0;
      snprintf(r.value, sizeof(r.value), "%ddBm", rssi);
      r.hasValue = true; r.icon = MI_WIFI;
    } else {
      const char* lbl = (idx == sc) ? "Rescan" : "Use phone";   // pick-from-scan only
      strncpy(r.label, lbl, sizeof(r.label) - 1); r.label[sizeof(r.label) - 1] = 0;
    }
    r.selected = sel;
  }
  return v;
}

static void wifiStartFlow() {
  s_wifiStep = WSTEP_SCAN; s_wifiCursor = 0; s_wifiScroll = 0; s_wifiSsid[0] = 0;
  Cloud::requestScan();
  enter(ST_WIFI_SETUP);
}
static void wifiBeginPassword() {
  s_wifiStep = WSTEP_PASS;
  Keyboard::begin(s_wifiSsid, /*masked*/ true);
  s_uiDirty = true;
}
#endif // USE_TOUCH

static void renderWifiSetup() {
  Display::clear();
  Display::center("WI-FI SETUP", 0, 1);
  Display::text(0, 16, 1, "Join Wi-Fi:");
  Display::text(8, 26, 1, Cloud::portalApName());
  Display::text(0, 38, 1, "Then open:");
  Display::text(8, 48, 1, Cloud::portalIp());
  Display::center("click = cancel", 56, 1);
  Display::show();
}

static void renderDiag() {
  char l[24];
  float lux = 0, lvar = 0, tempC = NAN;
  Sensors::readLight(lux, lvar);
  Sensors::readTemp(tempC);
  SensorHealth h = Sensors::health();
  Display::clear();
  Display::center("DIAGNOSTICS", 0, 1);
  snprintf(l, sizeof(l), "OLED:%s", Display::driverName());            Display::text(0, 10, 1, l);
  snprintf(l, sizeof(l), "ToF:%s %dmm", h.tofPresent ? "ok" : "--", Sensors::presenceMm());
  Display::text(0, 19, 1, l);
  snprintf(l, sizeof(l), "Noise:%ddB Btn:%s", (int)lroundf(Sensors::noiseDb()),
           Inputs::sideFault() ? "ERR" : (Inputs::sidePressed() ? "DN" : "up"));
  Display::text(0, 28, 1, l);
#if HAS_I2S_MIC
  // Raw ES8311/I2S state — the ground truth. ack=codec answered, rdy=I2S data flowing,
  // pp=last-second raw peak-to-peak (it should JUMP when you talk/clap near the mic).
  snprintf(l, sizeof(l), "8311:%s rdy:%d pp:%d",
           Audio::codecAcked() ? "ACK" : "no",
           Audio::micReady() ? 1 : 0, Audio::rawPeakToPeak());
  Display::text(0, 46, 1, l);
#endif
#if HAS_LIGHT
  snprintf(l, sizeof(l), "Lgt:%d", (int)lux);                          Display::text(0, 37, 1, l);
#endif
#if HAS_TEMP
  if (h.tempPresent) snprintf(l, sizeof(l), "Tmp:%dC", (int)tempC);
  else               snprintf(l, sizeof(l), "Tmp:--");
  Display::text(64, 37, 1, l);
#endif
  Display::center("knob or hold = back", 54, 1);
  Display::show();
}

namespace StateMachine {

void init() {
  s_bootAt = millis();
  s_cfg = Storage::loadConfig(defaultConfig());
  Haptics::setEnabled(s_cfg.hapticsEnabled);
  Sound::setEnabled(s_cfg.soundEnabled);
  Sound::setVolume(s_cfg.soundLevel);
  s_workDur  = Storage::workDurationMin();
  s_breakDur = Storage::breakDurationMin();
  s_cycleCount = Storage::cycleCount();
  Inputs::setMinutes(s_workDur);
  String full = Storage::deviceId();
  int dash = full.indexOf('-');
  s_devShort = (dash >= 0) ? full.substring(dash + 1) : full;
  Menu::begin(&s_mode, &s_workDur, &s_breakDur, &s_cycleCount, &s_cfg);
  // Cloud settings now arrive asynchronously via Cloud::takeSettings() in tick().

  if (Storage::loadCheckpoint(s_resumeCp)) {
    int remainSec = (int)(s_resumeCp.remainingMs / 1000);
    int remainMin = remainSec / 60;
    if (remainMin < 1 && remainSec > 0) remainMin = 1;
    Menu::resumePromptReset(remainMin, s_resumeCp.mode,
                            s_resumeCp.setFocusDone, s_resumeCp.setCycleTotal,
                            s_resumeCp.setActive != 0);
    enter(ST_RESUME);
  } else {
    // Offline-first: always boot to the usable menu. Wi-Fi is opt-in via
    // Device -> Wi-Fi Setup, so an un-provisioned box runs fully offline.
    enter(ST_IDLE);
  }
}

void tick() {
  // Touch dispatches transport-button taps directly only while the bare timer
  // is on screen (no overlay); everywhere else taps drive the menu cursor.
  Inputs::setTimerScreenActive(
    (s_state == ST_RUNNING || s_state == ST_PAUSED) &&
    !Menu::runningActive() && !s_pausedOverlay);
#if USE_TOUCH
  // Keyboard steps consume raw taps (Wi-Fi password / hidden SSID entry).
  Inputs::setRawTouchActive(s_state == ST_WIFI_SETUP && s_wifiStep == WSTEP_PASS);
#endif
  Inputs::poll();
  int  btn = Inputs::button();
  int  rot = Inputs::rotationDir();
  bool clk = Inputs::knobClicked();   // knob press = universal escape on dead-end screens
#if USE_SPDT_TOGGLE
  s_mode = Inputs::spdtPresentWork() ? MODE_WORK : MODE_BREAK;
#endif
  uint32_t now = millis();
  bool warm = (now - s_bootAt) > SENSOR_WARMUP_MS;

  // Quiet hours: dim the screen + mute haptics while active; restore on exit.
  // Applied only on transition so it doesn't fight live brightness changes.
  static int s_quietApplied = -1;
  int quiet = inQuietHours() ? 1 : 0;
  if (quiet != s_quietApplied) {
    s_quietApplied = quiet;
    Panel::setBrightness(quiet ? 15 : s_cfg.brightnessPct);
    Haptics::setEnabled(quiet ? false : s_cfg.hapticsEnabled);
    Sound::setEnabled(quiet ? false : s_cfg.soundEnabled);
  }

  // Auto-brightness: drive the backlight from the KY-018 light sensor (~1Hz, with hysteresis).
  // Yields to quiet hours (dims to 15) and to manual mode (autoBrightness off keeps brightnessPct).
#if HAS_LIGHT
  static uint32_t s_lastAutoBri = 0;
  static int      s_autoBriPct  = -1;
  if (s_cfg.autoBrightness && !quiet && now - s_lastAutoBri > 1000) {
    s_lastAutoBri = now;
    float lux = 0, var = 0; Sensors::readLight(lux, var);
    int pct = map(constrain((int)lux, 0, 1000), 0, 1000, 20, 100);  // dark -> 20%, bright -> 100%
    if (abs(pct - s_autoBriPct) >= 5) { s_autoBriPct = pct; Panel::setBrightness((uint8_t)pct); }
  }
#endif

  // Apply settings the net task pulled from the server. Device menu settings
  // live in NVS and survive power cycles — routine config polls must NOT
  // overwrite them (only seed once on first account link). STATIC: the struct
  // is ~2.9 KB since the week schedule joined it — keep it off the loop stack.
  static CloudSettings cs;
  if (Cloud::takeSettings(cs)) {
    bool wasPaired = Storage::paired();
    // After a local "Sign out", ignore a stale paired:true from a config fetch
    // that was already in flight, until the server-side unpair propagates (a
    // real paired:false then clears the guard).
    bool paired = cs.paired;
    if (paired && now < s_signOutGuardUntil) paired = false;
    else                                     s_signOutGuardUntil = 0;
    Storage::setPaired(paired);
    if (paired != wasPaired) s_uiDirty = true;

    if (paired && !wasPaired) {
      // First link: pull companion defaults once, then the box owns them in NVS.
      s_cfg.showTimer        = cs.showTimer;
      s_cfg.hapticsEnabled   = cs.hapticsEnabled;
      s_cfg.adaptiveCoaching = cs.adaptiveCoaching;
      s_cfg.nudgesEnabled    = cs.nudgesEnabled;
      s_cfg.quietStartMin    = cs.quietStartMin;
      s_cfg.quietEndMin      = cs.quietEndMin;
      s_cfg.dailyGoalMin     = cs.dailyGoalMin;
      applyConfig(s_cfg);
      Menu::setContext(Cloud::online(), true, s_devShort.c_str());
      Cloud::flagTransition();
    }

    if (paired) {
      bool acctChanged =
        Storage::ownerDisplayName() != String(cs.ownerDisplayName) ||
        Storage::ownerEmail() != String(cs.ownerEmail);
      Storage::setOwnerAccount(cs.ownerDisplayName, cs.ownerEmail);
      if (acctChanged) Menu::invalidate();
      Storage::setServerTodaySec(cs.todayFocusSec < 0 ? 0 : (uint32_t)cs.todayFocusSec);

      // Sound config is SITE-OWNED while paired: unlike the first-link-only seed
      // above, re-apply it on EVERY poll so a change on the website lands within
      // one config fetch. Persist to NVS only on change (flash wear); honour this
      // tick's quiet-hours mute (the transition-only gate above won't re-fire).
      if (s_cfg.soundEnabled != cs.soundEnabled || s_cfg.soundLevel != cs.soundLevel) {
        s_cfg.soundEnabled = cs.soundEnabled;
        s_cfg.soundLevel   = cs.soundLevel;
        Storage::saveConfig(s_cfg);
        Menu::invalidate();
      }
      Sound::setEnabled(quiet ? false : s_cfg.soundEnabled);
      Sound::setVolume(s_cfg.soundLevel);
      Sound::setChimeMask(cs.chimeMask);

      // Today's agenda + owner tz -> the FSM day-cache (Today screen + scheduled
      // auto-start read it). Full-array copy is fine: syncDownlink zero-inits cs.
      s_agendaCount = cs.agendaCount > AGENDA_MAX_ITEMS ? AGENDA_MAX_ITEMS : cs.agendaCount;
      memcpy(s_agenda, cs.agenda, sizeof(s_agenda));
      s_tzOffsetMin = cs.tzOffsetMin;
      s_autoStartEnabled = cs.autoStartEnabled;
      s_weekCount = cs.weekCount > WEEK_MAX_ITEMS ? WEEK_MAX_ITEMS : cs.weekCount;
      memcpy(s_week, cs.week, sizeof(s_week));

      // Accent preset is SITE-OWNED while paired: apply on CHANGE only (NVS
      // wear + full repaint are per-change costs, and the poll re-sends it).
      if (cs.themeId != Theme::accentPreset()) {
        Theme::setAccentPreset(cs.themeId);
        Storage::setThemeAccent(cs.themeId);
        Menu::invalidate();
        s_uiDirty = true;
      }

      // Pomodoro timing: adopt the site's focus/break ONCE per new timingRev.
      // The site save lands exactly once; later on-box spinner edits win until
      // the next site save. NVS writes only on a rev change.
      if (cs.timingRev != 0 && cs.timingRev != Storage::lastTimingRev()
          && cs.focusMin >= 5 && cs.focusMin <= 120 && cs.breakMin >= 1 && cs.breakMin <= 60) {
        s_workDur  = cs.focusMin;
        s_breakDur = cs.breakMin;
        Storage::setWorkDuration(s_workDur);
        Storage::setBreakDuration(s_breakDur);
        // Adopt the rest of the site's pomodoro rhythm in the SAME once-per-rev
        // block: cycles per set, and the long break AFTER the last focus block
        // of the set (longBreakEvery = cycleCount matches the website semantics).
        if (cs.cycles >= 1 && cs.cycles <= 8) {
          s_cycleCount = cs.cycles;
          Storage::setCycleCount(s_cycleCount);
        }
        if (cs.longBreakMin >= 1 && cs.longBreakMin <= 60) {
          s_cfg.longBreakMin     = cs.longBreakMin;
          s_cfg.longBreakEnabled = true;
          s_cfg.longBreakEvery   = s_cycleCount;   // long break after the last one
          Storage::saveConfig(s_cfg);              // long-break lives in DeviceConfig NVS
        }
        Storage::setLastTimingRev(cs.timingRev);
        if (s_state == ST_IDLE) Inputs::setMinutes(s_workDur);  // refresh the shown duration
        Menu::invalidate();
        s_uiDirty = true;
        Serial.printf("[cloud] adopted site timing %d/%d x%d lb%d (rev %lu)\n",
                      s_workDur, s_breakDur, s_cycleCount, (int)s_cfg.longBreakMin,
                      (unsigned long)cs.timingRev);
      }

      // Exam DND + idle badge + server stats + homework cache (all RAM only —
      // each re-arrives on every poll; unpair below clears them).
      s_examMode = cs.examMode;
      Sound::setDnd(s_examMode);
      Menu::setExamInfo(cs.nextExamDays, cs.nextExamTitle);
      Menu::setCloudStats(cs.streakDays, cs.weekFocusMin);
      if (s_state != ST_HOMEWORK) {   // don't yank rows out from under the open screen
        s_hwCount = cs.hwCount > HW_MAX_ITEMS ? HW_MAX_ITEMS : cs.hwCount;
        memcpy(s_hw, cs.hw, sizeof(s_hw));
      }
    } else if (wasPaired) {
      // Remote sign-out from the web app: drop the account locally + notify.
      // (The box keeps no owner identity on-device; unpair is the whole state.)
      Storage::clearOwnerAccount();
      Menu::invalidate();
      Storage::setServerTodaySec(0);
      s_agendaCount = 0;                  // agenda/auto-start are account data
      s_weekCount = 0;
      s_autoStartEnabled = false;
      s_examMode = false;                 // exam/homework/stats are account data too
      Sound::setDnd(false);
      s_hwCount = 0;
      Menu::setExamInfo(-1, "");
      Menu::setCloudStats(-1, -1);
      Sound::setChimeMask(0xFF);          // back to local-only sound control
      if (s_cfg.hapticsEnabled) Haptics::reset();
      s_uiDirty = true;
      Serial.println("[device] account unlinked from the app — signed out");
    }
  }

  // Remote commands from the app (queued by the net task's config poll).
  { RemoteCmd rc;
    if (Cloud::nextCommand(rc)) handleRemoteCmd(rc); }

  // Live mirror: refresh the net task's snapshot ~1 Hz (transitions push instantly).
  if (now - s_lastSnap > 1000) { s_lastSnap = now; publishTelemetry(); }

  unsigned long pauseMs = presencePauseMs(s_cfg);
  unsigned long endMs   = presenceEndMs(s_cfg);

  switch (s_state) {
    case ST_IDLE: {
      updateTodayLiveFocus();
      if (Cloud::online() && !Storage::paired()) {
        if (now - s_lastIdleConfigPoll > CONFIG_FETCH_UNPAIRED_MS) {
          s_lastIdleConfigPoll = now;
          Cloud::requestConfigSync();
        }
      } else {
        s_lastIdleConfigPoll = 0;
      }
      if (s_pendingMsg[0]) {             // message held during a session -> show now
        char body[48];
        strncpy(body, s_pendingMsg, sizeof(body) - 1);
        body[sizeof(body) - 1] = 0;
        s_pendingMsg[0] = 0;
        enterMessage("Message", body);
        break;
      }
      if (tickScheduledStart()) break;   // agenda study block due -> splash (ST_AUTOSTART)
      Menu::setContext(Cloud::online(), Storage::paired(), s_devShort.c_str());
      MenuAction ma = Menu::tick(rot, btn);
      if (rot || btn) s_uiDirty = true;
      handleMenuAction(ma);
      break;
    }

    case ST_RESUME: {
      updateTodayLiveFocus();
      if (btn == 2) { discardCheckpoint(); break; }   // long-press = don't resume
      MenuAction ma = Menu::resumePromptTick(rot, btn);
      if (rot || btn) s_uiDirty = true;
      handleMenuAction(ma);
      break;
    }

    case ST_CYCLE_OFFER: {
      MenuAction ma = Menu::cycleOfferTick(rot, btn);
      if (rot || btn) s_uiDirty = true;
      handleMenuAction(ma);
      break;
    }

    case ST_AUTOSTART:
      // Any press cancels — the block was marked handled when the splash rose,
      // so it will not retrigger today.
      if (btn == 1 || btn == 2 || clk) { Haptics::click(); enter(ST_IDLE); break; }
      if (now - s_stateAt >= AUTOSTART_SPLASH_MS) {
        clearSet();   // a scheduled block runs as a single interval, not a set
        startSessionMode(MODE_WORK, s_autoDurMin);
        break;
      }
      s_uiDirty = true;   // countdown repaint (shouldRender throttles to ~200 ms)
      break;

    case ST_AGENDA:
      // Swipe/rotate pages across the week (0 = today .. 6); presses exit as
      // before (read-only screen). Day 0 keeps the exact old behavior.
      if (rot) {
        int d = (int)s_agendaDay + rot;
        if (d < 0) d = 0;
        if (d > (int)AGENDA_MAX_DAY) d = AGENDA_MAX_DAY;
        if (d != (int)s_agendaDay) { s_agendaDay = (uint8_t)d; Haptics::click(); }
      }
      if (btn == 1 || btn == 2 || clk) enter(ST_IDLE);   // read-only: any press exits
      s_uiDirty = true;   // repaint so the now/next highlight tracks the clock
      break;

    case ST_MESSAGE:
      // Any press dismisses; otherwise auto-dismiss after the countdown.
      if (btn == 1 || btn == 2 || clk) { Haptics::click(); enter(ST_IDLE); break; }
      if (now - s_stateAt >= MESSAGE_SPLASH_MS) { enter(ST_IDLE); break; }
      s_uiDirty = true;   // countdown repaint (shouldRender throttles to ~200 ms)
      break;

    case ST_HOMEWORK: {
      // Post-focus quick-update. Swipe/rotate = row cursor (rows + Skip); tap =
      // +25% on a row (100 marks done) or exit on Skip; long-press = mark the
      // row done / exit on Skip; 20 s without input -> idle.
      if (now - s_stateAt >= HOMEWORK_TIMEOUT_MS) { enter(ST_IDLE); break; }
      int rows = (int)s_hwCount + 1;                     // + the Skip row
      if (rot) {
        s_hwCursor += rot;
        while (s_hwCursor < 0)      s_hwCursor += rows;
        while (s_hwCursor >= rows)  s_hwCursor -= rows;
        Haptics::click();
        s_stateAt = now;                                 // any input re-arms the timeout
        s_uiDirty = true;
      }
      if ((btn == 1 || btn == 2) && s_hwCursor >= (int)s_hwCount) {  // Skip row
        enter(ST_IDLE);
        break;
      }
      if ((btn == 1 || btn == 2 || clk) && s_hwCount == 0) { enter(ST_IDLE); break; }
      if (btn == 1 || btn == 2) {                        // tap = +25 · hold = done
        HwItem& it = s_hw[s_hwCursor];
        int pct = (btn == 2) ? 100 : (int)it.pct + 25;
        if (pct > 100) pct = 100;
        if (pct != (int)it.pct) {
          it.pct = (uint8_t)pct;
          Cloud::postHomework(it.id, it.pct);            // queued; net task POSTs it
        }
        Haptics::tap();
        s_stateAt = now;
        s_uiDirty = true;
      }
      break;
    }

    case ST_RUNNING:
      if (Sensors::faulted()) { enter(ST_ERROR); break; }
      if (Menu::runningActive()) {
        // Back (long-press) is handled inside runningTick: in the Settings sub-list it steps back to the
        // top overlay; in the top overlay it dismisses (back to the running timer). The session never
        // ends here — End is an explicit row; abort is a long-press on the bare timer below.
        MenuAction ra = Menu::runningTick(rot, btn);
        if (rot || btn) s_uiDirty = true;
        handleMenuAction(ra);
        break;
      }
      // Control circles (touch): gear opens options; transport acts directly.
      { int ta = Inputs::timerAction();
        if (ta == TimerScreen::TA_MENU) {   // tap: open the SESSION menu (Pause/Skip/End/Settings) — clock keeps running
          Menu::runningOpen();
          s_uiDirty = true;
          break;
        }
        if (ta == TimerScreen::TA_PAUSE) {
          Session::addBreak();
          Haptics::pause();
          Sound::pause();
          saveCheckpointNow();
          enterPaused(PAUSE_MANUAL);
          break;
        }
        if (ta == TimerScreen::TA_SKIP)  { Session::pauseClock(); onTimerComplete(); break; }
        if (ta == TimerScreen::TA_RESET) { restartCurrentInterval(); break; }
      }
      if (btn == 2) { beginEnd("aborted"); break; }
      if (btn == 1) {   // encoder click = same as a tap: open the session menu (Pause/Skip/End/Settings)
        Menu::runningOpen();
        s_uiDirty = true;
        break;
      }
      {
        // Away handling, decoupled: record the away event + duration ALWAYS (for data), but PAUSE only if the
        // user enabled auto-pause. With auto-pause off the clock keeps running (away counts as elapsed) and the
        // away duration is recorded separately, so the dashboard can show true focus = elapsed - away.
        bool present = Sensors::present();
        bool awayNow = warm && !present && Sensors::absentForMs() > pauseMs;
        if (awayNow && !s_wasAway) Session::addPresenceInterruption();   // count once per away edge
        s_wasAway = awayNow;
        Session::setAway(warm && !present);                             // accrue away duration (raw presence)
        if (s_cfg.autoPause && awayNow) {
          Haptics::pause();
          Sound::pause();
          saveCheckpointNow();
          enterPaused(PAUSE_AWAY);
          break;
        }
        Session::setSamplePeriodMs(sessionSamplePeriodMs());
        Session::tick(s_cfg.autoPause ? present : true);   // auto-pause OFF -> clock never freezes on away
      }
      tickAdaptiveCoaching(now);
      // Environment interference: track the current alert, remember it, nudge if it persists.
      {
        uint8_t intf = currentInterference();
        if (intf != s_curInterf) {
          s_curInterf = intf;
          s_interfSince = now;
          s_interfNudged = false;
          s_uiDirty = true;
        }
        if (intf != INTERF_NONE) {
          s_sessionWorst = intf;   // most recent disruption (shown on DONE)
          // Exam DND also suppresses the interference nudge (haptic + chime);
          // the on-screen interference label keeps tracking regardless.
          if (s_cfg.alertNudge && !s_examMode && !s_interfNudged &&
              (now - s_interfSince) > INTERF_NUDGE_MS) {
            if (s_cfg.hapticsEnabled) Haptics::pause();
            // The S3 has no motor (HAS_HAPTIC=0), so back the nudge with the
            // alert chime (chimeMask bit3 + sound/quiet gating live in Sound).
            // s_interfNudged is only per-EPISODE (resets when the interference
            // type flips), so rate-limit across episodes too: at most one chime
            // per INTERF_ALERT_GAP_MS per session — it nags, not screams.
            if (s_lastInterfChime == 0 || now - s_lastInterfChime > INTERF_ALERT_GAP_MS) {
              s_lastInterfChime = now;
              Sound::alert();
            }
            s_interfNudged = true;
            s_uiDirty = true;
          }
        }
      }
      if (Session::finished()) {
        Session::pauseClock();
        onTimerComplete();
        break;
      }
      if (runningScreenChanged()) s_uiDirty = true;
      break;

    case ST_PAUSED:
      // Presence auto-resume / auto-end take priority (unchanged behaviour).
      if (s_pauseReason == PAUSE_AWAY && Sensors::present()) {
        Session::resumeClock();
        saveCheckpointNow();
        Haptics::resume();
        Sound::resume();
        enter(ST_RUNNING);
        break;
      }
      if (s_pauseReason == PAUSE_AWAY && endMs > 0 && Sensors::absentForMs() > endMs) {
        beginEnd("interrupted");
        break;
      }
#if USE_TOUCH
      // Paused timer (touch): ANY tap resumes — no paused menu. A long-press (encoder/side button)
      // ends the session as a fallback. Skip/End during a session are done from the running options menu.
      if (Inputs::timerAction() != TimerScreen::TA_NONE || btn == 1) {
        Session::resumeClock();
        saveCheckpointNow();
        Haptics::resume();
        Sound::resume();
        enter(ST_RUNNING);
        break;
      }
      if (btn == 2) { beginEnd("interrupted"); break; }   // physical long-press = end (fallback)
      break;
#else
      if (btn == 2) { beginEnd("interrupted"); break; }
      {
        MenuAction pa = Menu::pausedTick(rot, btn);
        if (rot || btn) s_uiDirty = true;
        handleMenuAction(pa);
      }
      break;
#endif

    case ST_COMPLETE:
      if (now - s_stateAt >= 2000) {
        if (s_pendingCycleOffer) {
          s_pendingCycleOffer = false;
          if (s_cfg.autoStartCycle) {
            startSessionMode(s_cycleNextMode, s_cycleNextMin);   // skip the NEXT prompt
          } else {
            Menu::cycleOfferReset(s_cycleNextMode, s_cycleNextMin,
                                  s_setFocusDone, s_setCycleTotal);
            enter(ST_CYCLE_OFFER);
          }
        } else {
          s_pendingSetComplete = false;
          // Exactly where the flow would otherwise go idle: after a finished
          // WORK interval (never mid-chain — no cycle offer pending), offer the
          // homework quick-update if the site sent pending items.
          if (s_lastRec.mode == MODE_WORK && Storage::paired() && s_hwCount > 0) {
            s_hwCursor = 0;
            enter(ST_HOMEWORK);
          } else {
            enter(ST_IDLE);
          }
        }
      }
      break;

    case ST_PAIRING:
      if (now - s_lastPairConfigPoll >= CONFIG_FETCH_PAIRING_MS) {
        s_lastPairConfigPoll = now;
        Cloud::requestConfigSync();
      }
      if (Storage::paired()) {
        s_pairCode[0] = 0;
        s_uiDirty = true;
      }
      if (btn == 1 || btn == 2 || clk) { s_pairCode[0] = 0; enter(ST_IDLE); }
      break;

    case ST_DIAG:
      if (btn == 1 || btn == 2 || clk) enter(ST_IDLE);
      s_uiDirty = true;
      break;

    case ST_WIFI_SETUP:
#if USE_TOUCH
      if (s_wifiStep == WSTEP_SCAN) {
        if (btn == 2) { enter(ST_IDLE); break; }            // back-chip exits
        if (rot)      { s_wifiCursor += rot; wifiClampCursor(); s_uiDirty = true; }
        if (btn == 1) {
          int sc = Cloud::scanCount();
          if (s_wifiCursor < sc) {                          // picked a network
            int rssi = 0; bool sec = false;
            Cloud::scanResult(s_wifiCursor, s_wifiSsid, sizeof(s_wifiSsid), rssi, sec);
            wifiBeginPassword();
          } else {
            int extra = s_wifiCursor - sc;
            if (extra == 0) { Cloud::requestScan(); s_uiDirty = true; }        // Rescan
            else { Cloud::startWifiPortal(); s_wifiStep = WSTEP_PORTAL;
                   s_portalReqAt = now; s_portalSeenUp = false; s_uiDirty = true; }  // Use phone
          }
        }
        break;
      }
      if (s_wifiStep == WSTEP_PASS) {
        if (Inputs::tapped()) Keyboard::handleTap(Inputs::tapX(), Inputs::tapY());
        if (btn == 2 || Keyboard::cancelled()) { s_wifiStep = WSTEP_SCAN; s_uiDirty = true; break; }
        if (Keyboard::done()) {
          Cloud::saveWifi(String(s_wifiSsid), String(Keyboard::text()));
          s_wifiStep = WSTEP_CONNECT; s_wifiConnectAt = now; s_uiDirty = true;
          break;
        }
        if (Keyboard::dirty()) s_uiDirty = true;
        break;
      }
      if (s_wifiStep == WSTEP_CONNECT) {
        if (Cloud::online()) { Haptics::tap(); enter(ST_IDLE); break; }   // joined
        if (now - s_wifiConnectAt > WIFI_CONNECT_TIMEOUT_MS) {
          if (btn == 1) { wifiBeginPassword(); break; }                  // retry password
          if (btn == 2) { s_wifiStep = WSTEP_SCAN; s_uiDirty = true; break; }
        }
        s_uiDirty = true;   // keep polling online + refresh status
        break;
      }
      // WSTEP_PORTAL — SoftAP setup portal. The AP is raised asynchronously by the
      // net task, so wait for it (grace window) instead of bailing to the menu the
      // instant it isn't active yet. Exit on a tap, once it's been up and is then
      // torn down (creds saved / timed out), or if it never rises within the window.
      if (btn == 1 || btn == 2 || clk) { Cloud::stopWifiPortal(); enter(ST_IDLE); break; }
      if (Cloud::portalActive()) s_portalSeenUp = true;
      else if (s_portalSeenUp || now - s_portalReqAt > PORTAL_START_GRACE_MS) enter(ST_IDLE);
      s_uiDirty = true;
      break;
#else
      // No-touch build: SoftAP portal only. Same async-raise grace as above.
      if (btn == 1 || btn == 2 || clk) { Cloud::stopWifiPortal(); enter(ST_IDLE); break; }
      if (Cloud::portalActive()) s_portalSeenUp = true;
      else if (s_portalSeenUp || now - s_portalReqAt > PORTAL_START_GRACE_MS) enter(ST_IDLE);
      s_uiDirty = true;
      break;
#endif

    case ST_ERROR:
      if (btn == 2 || clk) { Sensors::clearFault(); enter(ST_IDLE); }
      break;

    default: break;
  }

  if (shouldRender(now)) {
    if (s_state == ST_DIAG) {
      renderDiag();
    } else if (s_state == ST_WIFI_SETUP) {
#if USE_TOUCH
      if (s_wifiStep == WSTEP_SCAN) {
        if (Cloud::scanBusy()) { Display::clear(); Display::center("scanning...", 24, 1); Display::show(); }
        else                   Display::renderMenu(wifiScanView());
      } else if (s_wifiStep == WSTEP_PASS) {
        Keyboard::render();
      } else if (s_wifiStep == WSTEP_CONNECT) {
        Display::clear();
        Display::center("connecting...", 16, 1);
        Display::center(s_wifiSsid, 32, 1);
        if (millis() - s_wifiConnectAt > WIFI_CONNECT_TIMEOUT_MS)
          Display::center("failed-tap retry", 48, 1);
        Display::show();
      } else {
        renderWifiSetup();
      }
#else
      renderWifiSetup();
#endif
    } else if (s_state == ST_AGENDA) {
      char hdr[16];
      agendaDayLabel(hdr, sizeof(hdr));
      bool hasNext = s_agendaDay < AGENDA_MAX_DAY;
      if (s_agendaDay == 0) {
        int nowMin; uint32_t day;
        if (!ownerLocalNow(nowMin, day)) nowMin = -1;   // no clock -> no highlight
        Display::renderAgenda(s_agenda, s_agendaCount, nowMin, 0, hdr, false, hasNext);
      } else {
        // Paged day: week[] filtered by dayOffset into AgendaItem rows (same
        // renderer/row style; no now/next highlight off-day).
        AgendaItem items[AGENDA_DAY_ROWS];
        uint8_t n = 0;
        for (uint8_t i = 0; i < s_weekCount && n < AGENDA_DAY_ROWS; i++) {
          if (s_week[i].dayOffset != s_agendaDay) continue;
          items[n].startMin = s_week[i].startMin;
          items[n].endMin   = s_week[i].endMin;
          items[n].kind     = s_week[i].kind;
          strncpy(items[n].title, s_week[i].title, sizeof(items[n].title) - 1);
          items[n].title[sizeof(items[n].title) - 1] = 0;
          n++;
        }
        Display::renderAgenda(items, n, -1, s_agendaDay, hdr, true, hasNext);
      }
    } else if (s_state == ST_AUTOSTART) {
      uint32_t el = millis() - s_stateAt;
      int left = (el >= AUTOSTART_SPLASH_MS) ? 0
               : (int)((AUTOSTART_SPLASH_MS - el + 999) / 1000);
      Display::renderAutoStart(s_autoTitle, left);
    } else if (s_state == ST_MESSAGE) {
      uint32_t el = millis() - s_stateAt;
      int left = (el >= MESSAGE_SPLASH_MS) ? 0
               : (int)((MESSAGE_SPLASH_MS - el + 999) / 1000);
      Display::renderMessage(s_msgTitle, s_msgBody, left);
    } else if (s_state == ST_HOMEWORK) {
      Display::renderHomework(s_hw, s_hwCount, (uint8_t)s_hwCursor);
    } else if (s_state == ST_IDLE) {
      Display::renderMenu(Menu::view());
    } else if (s_state == ST_RESUME) {
      Display::renderMenu(Menu::resumePromptView());
    } else if (s_state == ST_CYCLE_OFFER) {
      Display::renderMenu(Menu::cycleOfferView());
    } else if (s_state == ST_PAUSED && s_pausedOverlay) {
      Display::renderMenu(Menu::pausedView());
    } else if (s_state == ST_RUNNING && Menu::runningActive()) {
      Display::renderMenu(Menu::runningView());
    } else {
      Display::render(buildModel());
    }
    LedRing::show(s_state, s_mode, fracRemaining());
    s_lastRender = now;
    s_uiDirty = false;
  }
}

SysState state()       { return s_state; }
Mode     mode()        { return s_mode; }
int      durationMin() { return activeDur(); }

const DeviceConfig& config() { return s_cfg; }

void applyConfig(const DeviceConfig& c) {
  s_cfg = c;
  Haptics::setEnabled(c.hapticsEnabled);
  Haptics::setLevel(c.hapticLevel);
  Sound::setEnabled(c.soundEnabled);
  Sound::setVolume(c.soundLevel);
  Panel::setBrightness(c.brightnessPct);
  Storage::saveConfig(c);
  s_uiDirty = true;
}

} // namespace StateMachine
