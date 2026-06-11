#include "StateMachine.h"
#include "config.h"
#include "Inputs.h"
#include "Sensors.h"
#include "Session.h"
#include "Display.h"
#include "Haptics.h"
#include "LedRing.h"
#include "Storage.h"
#include "Cloud.h"
#include "Menu.h"
#include "Payload.h"

static SysState     s_state = ST_BOOTING;
static Mode         s_mode  = MODE_WORK;
static int          s_workDur  = DUR_DEFAULT_MIN;
static int          s_breakDur = 5;
static int          s_cycleCount = CYCLE_DEFAULT;
static DeviceConfig s_cfg   = defaultConfig();
static uint32_t     s_stateAt = 0, s_lastRender = 0, s_bootAt = 0;
static uint32_t     s_lastCheckpoint = 0;
static uint32_t     s_lastCfgFetch = 0;
static bool         s_uiDirty = true;
static String       s_devShort;
static char         s_pairCode[7] = {0};

static bool         s_pendingCycleOffer = false;
static bool         s_pendingSetComplete = false;
static Mode         s_cycleNextMode = MODE_BREAK;
static int          s_cycleNextMin = 5;
static SessionCheckpoint s_resumeCp = {};

static bool         s_setActive = false;
static int          s_setCycleTotal = CYCLE_DEFAULT;
static int          s_setFocusDone = 0;

static PauseReason  s_pauseReason = PAUSE_MANUAL;
static uint32_t     s_lastCoachAt = 0;

static int activeDur() {
  return s_mode == MODE_WORK ? s_workDur : s_breakDur;
}

static void enter(SysState s) {
  s_state = s;
  s_stateAt = millis();
  s_uiDirty = true;
  if (s == ST_IDLE) Menu::resetToRoot();
  if (s == ST_PAUSED) Menu::pausedReset(s_pauseReason);
}

static void enterPaused(PauseReason reason) {
  s_pauseReason = reason;
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
  m.pauseReason    = s_pauseReason;
  m.wifi           = Cloud::online();
  m.present        = Sensors::present();
  m.paired         = Storage::paired();
  m.deviceId       = s_devShort.c_str();
  m.pairCode       = s_pairCode;
  return m;
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
  SessionRecord r = Session::finish(status, endE, seq);
  bool goalHit = Storage::bufferSession(r);
  Storage::setLiveFocusSec(0);              // avoid the transient today double-count
  Storage::setWorkDuration(s_workDur);
  Storage::setBreakDuration(s_breakDur);
  Storage::clearCheckpoint();
  // Part A: emit the exact upload JSON (contract check; Part B/C consume this shape).
  Serial.println(Payload::sessionJson(r, Session::samples(), Session::sampleCount(),
                                      Storage::deviceId().c_str()));
  Cloud::uploadSession(r, Session::samples(), Session::sampleCount());
  return goalHit;
}

static void enterPairing() {
  snprintf(s_pairCode, sizeof(s_pairCode), "%06u", (unsigned)(esp_random() % 1000000u));
  Cloud::publishPairingCode(s_pairCode);
  enter(ST_PAIRING);
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

static void startSessionMode(Mode m, int durMin) {
  s_mode = m;
  s_lastCoachAt = 0;
  time_t st = Cloud::haveClock() ? Cloud::nowEpoch() : 0;
  Session::start(m, durMin, st);
  saveCheckpointNow();
  Haptics::tap();
  enter(ST_RUNNING);
}

static void startSession() {
  startSet();
  startSessionMode(MODE_WORK, s_workDur);
}

static void scheduleCycleOffer(Mode completedMode) {
  s_pendingCycleOffer = true;
  s_pendingSetComplete = false;
  if (completedMode == MODE_WORK) {
    s_cycleNextMode = MODE_BREAK;
    s_cycleNextMin  = s_breakDur;
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
  enter(ST_COMPLETE);
}

static void onTimerComplete() {
  Mode completed = s_mode;
  (void)persistSession("completed");

  if (s_setActive && completed == MODE_WORK) {
    s_setFocusDone++;
    if (s_setFocusDone >= s_setCycleTotal) {
      clearSet();
      s_pendingCycleOffer = false;
      s_pendingSetComplete = true;
      Storage::recordSetComplete();
      Haptics::complete();
      enter(ST_COMPLETE);
      return;
    }
    scheduleCycleOffer(MODE_WORK);
  } else if (s_setActive && completed == MODE_BREAK) {
    if (s_setFocusDone < s_setCycleTotal)
      scheduleCycleOffer(MODE_BREAK);
    else {
      clearSet();
      s_pendingCycleOffer = false;
    }
  } else {
    scheduleCycleOffer(completed);
  }

  if (s_cfg.hapticsEnabled) Haptics::complete();
  enter(ST_COMPLETE);
}

static void resumeFromCheckpoint() {
  Session::restore(s_resumeCp);
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
    Session::markResumed();
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

static void maybeCheckpoint(uint32_t now) {
  if (s_state != ST_RUNNING && s_state != ST_PAUSED) return;
  if (now - s_lastCheckpoint >= CHECKPOINT_PERIOD_MS)
    saveCheckpointNow();
}

static void tickAdaptiveCoaching(uint32_t now) {
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

static void handleMenuAction(MenuAction a) {
  switch (a) {
    case MENU_START_SESSION:  startSession(); break;
    case MENU_ENTER_PAIRING:  enterPairing(); break;
    case MENU_ENTER_DIAGNOSTICS: enter(ST_DIAG); break;
    case MENU_RESUME_SESSION:
      Session::markResumed();
      saveCheckpointNow();
      Haptics::resume();
      enter(ST_RUNNING);
      break;
    case MENU_END_SESSION:
      beginEnd("interrupted");
      break;
    case MENU_PAUSE_SESSION:
      Session::addBreak();
      Haptics::pause();
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
      clearSet();
      enter(ST_IDLE);
      break;
    default: break;
  }
}

static void renderDiag() {
  char l[24];
  Display::clear();
  Display::center("DIAGNOSTICS", 0, 1);
  snprintf(l, sizeof(l), "OLED: %s", Display::driverName());           Display::text(0, 14, 1, l);
  SensorHealth h = Sensors::health();
  snprintf(l, sizeof(l), "ToF: %s %dmm", h.tofPresent ? "ok" : "--", Sensors::presenceMm());
  Display::text(0, 26, 1, l);
  snprintf(l, sizeof(l), "Mic: %d%%", (int)(Sensors::noise() * 100));  Display::text(0, 38, 1, l);
  snprintf(l, sizeof(l), "Btn:%s r=%d", Inputs::sideFault() ? "ERR"
             : (Inputs::sidePressed() ? "DN" : "up"), Inputs::sideRaw());
  Display::text(0, 50, 1, l);
  Display::show();
}

namespace StateMachine {

void init() {
  s_bootAt = millis();
  s_cfg = Storage::loadConfig(defaultConfig());
  Haptics::setEnabled(s_cfg.hapticsEnabled);
  s_workDur  = Storage::workDurationMin();
  s_breakDur = Storage::breakDurationMin();
  s_cycleCount = Storage::cycleCount();
  Inputs::setMinutes(s_workDur);
  String full = Storage::deviceId();
  int dash = full.indexOf('-');
  s_devShort = (dash >= 0) ? full.substring(dash + 1) : full;
  Menu::begin(&s_mode, &s_workDur, &s_breakDur, &s_cycleCount, &s_cfg);
  // Overlay the owner's cloud settings onto the loaded config (no-op offline).
  if (Cloud::fetchConfig(s_cfg)) applyConfig(s_cfg);

  if (Storage::loadCheckpoint(s_resumeCp)) {
    int remainSec = (int)(s_resumeCp.remainingMs / 1000);
    int remainMin = remainSec / 60;
    if (remainMin < 1 && remainSec > 0) remainMin = 1;
    Menu::resumePromptReset(remainMin, s_resumeCp.mode,
                            s_resumeCp.setFocusDone, s_resumeCp.setCycleTotal,
                            s_resumeCp.setActive != 0);
    enter(ST_RESUME);
  } else {
    enter(ST_IDLE);
  }
}

void tick() {
  Inputs::poll();
  int  btn = Inputs::button();
  int  rot = Inputs::rotationDir();
#if USE_SPDT_TOGGLE
  s_mode = Inputs::spdtPresentWork() ? MODE_WORK : MODE_BREAK;
#endif
  uint32_t now = millis();
  bool warm = (now - s_bootAt) > SENSOR_WARMUP_MS;

  // Config downlink: pull the owner's settings periodically; apply only on change.
  if (Cloud::online() && now - s_lastCfgFetch > CONFIG_FETCH_MS) {
    s_lastCfgFetch = now;
    DeviceConfig c = s_cfg;
    if (Cloud::fetchConfig(c) && memcmp(&c, &s_cfg, sizeof(c)) != 0) applyConfig(c);
  }

  unsigned long pauseMs = presencePauseMs(s_cfg);
  unsigned long endMs   = presenceEndMs(s_cfg);

  switch (s_state) {
    case ST_IDLE: {
      updateTodayLiveFocus();
      Menu::setContext(Cloud::online(), Storage::paired(), s_devShort.c_str());
      MenuAction ma = Menu::tick(rot, btn);
      if (rot || btn) s_uiDirty = true;
      handleMenuAction(ma);
      break;
    }

    case ST_RESUME: {
      updateTodayLiveFocus();
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

    case ST_RUNNING:
      maybeCheckpoint(now);
      if (Sensors::faulted()) { enter(ST_ERROR); break; }
      if (Menu::runningActive()) {
        if (btn == 2) { beginEnd("aborted"); Menu::runningDismiss(); break; }
        MenuAction ra = Menu::runningTick(rot, btn);
        if (rot || btn) s_uiDirty = true;
        handleMenuAction(ra);
        break;
      }
      if (btn == 2) { beginEnd("aborted"); break; }
      if (btn == 1) { Menu::runningOpen(); s_uiDirty = true; break; }
      if (warm && s_cfg.autoPause && !Sensors::present() &&
          Sensors::absentForMs() > pauseMs) {
        Session::addPresenceInterruption();
        Haptics::pause();
        saveCheckpointNow();
        enterPaused(PAUSE_AWAY);
        break;
      }
      Session::tick(Sensors::present());
      tickAdaptiveCoaching(now);
      if (Session::finished()) {
        onTimerComplete();
        break;
      }
      s_uiDirty = true;
      break;

    case ST_PAUSED:
      maybeCheckpoint(now);
      if (btn == 2) { beginEnd("interrupted"); break; }
      if (s_pauseReason == PAUSE_AWAY && Sensors::present()) {
        Session::markResumed();
        saveCheckpointNow();
        Haptics::resume();
        enter(ST_RUNNING);
        break;
      }
      if (s_pauseReason == PAUSE_AWAY && endMs > 0 && Sensors::absentForMs() > endMs) {
        beginEnd("interrupted");
        break;
      }
      {
        MenuAction pa = Menu::pausedTick(rot, btn);
        if (rot || btn) s_uiDirty = true;
        handleMenuAction(pa);
      }
      break;

    case ST_COMPLETE:
      if (now - s_stateAt >= 2000) {
        if (s_pendingCycleOffer) {
          s_pendingCycleOffer = false;
          Menu::cycleOfferReset(s_cycleNextMode, s_cycleNextMin,
                                s_setFocusDone, s_setCycleTotal);
          enter(ST_CYCLE_OFFER);
        } else {
          s_pendingSetComplete = false;
          enter(ST_IDLE);
        }
      }
      s_uiDirty = true;
      break;

    case ST_PAIRING:
      if (btn == 1 || btn == 2) { s_pairCode[0] = 0; enter(ST_IDLE); }
      break;

    case ST_DIAG:
      if (btn == 1 || btn == 2) enter(ST_IDLE);
      s_uiDirty = true;
      break;

    case ST_ERROR:
      if (btn == 2) enter(ST_IDLE);
      break;

    default: break;
  }

  if (s_uiDirty || now - s_lastRender > 200) {
    if (s_state == ST_DIAG) {
      renderDiag();
    } else if (s_state == ST_IDLE) {
      Display::renderMenu(Menu::view());
    } else if (s_state == ST_RESUME) {
      Display::renderMenu(Menu::resumePromptView());
    } else if (s_state == ST_CYCLE_OFFER) {
      Display::renderMenu(Menu::cycleOfferView());
    } else if (s_state == ST_PAUSED) {
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
  Storage::saveConfig(c);
  s_uiDirty = true;
}

} // namespace StateMachine
