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

static SysState     s_state = ST_BOOTING;
static Mode         s_mode  = MODE_WORK;
static int          s_dur   = DUR_DEFAULT_MIN;
static DeviceConfig s_cfg   = defaultConfig();
static uint32_t     s_stateAt = 0, s_lastRender = 0, s_bootAt = 0;
static bool         s_uiDirty = true;

static void enter(SysState s) { s_state = s; s_stateAt = millis(); s_uiDirty = true; }

static float fracRemaining() {
  int t = Session::targetSec();
  return t > 0 ? (float)Session::remainingSec() / t : 0;
}

static UiModel buildModel() {
  UiModel m;
  m.state          = s_state;
  m.mode           = s_mode;
  m.durationMin    = s_dur;
  m.showTimer      = s_cfg.showTimer;
  m.remainingSec   = Session::remainingSec();
  m.targetSec      = Session::targetSec();
  m.actualFocusMin = Session::actualFocusMin();
  m.wifi           = Cloud::online();
  m.present        = Sensors::present();
  return m;
}

static void cycleMode() {
#if USE_SPDT_TOGGLE
  /* mode is hardware-driven; ignore knob clicks */
#else
  s_mode = (s_mode == MODE_WORK) ? MODE_BREAK : MODE_WORK;
  Haptics::click(); s_uiDirty = true;
#endif
}

static void startSession() {
  time_t st = Cloud::haveClock() ? Cloud::nowEpoch() : 0;
  Session::start(s_mode, s_dur, st);
  Haptics::tap();
  enter(ST_RUNNING);
}

static void endSession(const char* status) {
  enter(ST_LOGGING);
  Display::render(buildModel());        // show "syncing..." immediately
  time_t endE = Cloud::haveClock() ? Cloud::nowEpoch() : 0;
  uint32_t seq = Storage::nextSeq();
  SessionRecord r = Session::finish(status, endE, seq);
  Storage::bufferSession(r);
  Storage::setLastDuration(s_dur);
  Cloud::uploadSession(r, Session::samples(), Session::sampleCount());  // buffered if offline
  Haptics::complete();
  enter(ST_IDLE);
}

// On-box diagnostics screen (Story 15): sensor connection + live readings.
static void renderDiag() {
  char l[24];
  Display::clear();
  Display::center("DIAGNOSTICS", 0, 1);
  snprintf(l, sizeof(l), "OLED: %s", Display::driverName());           Display::text(0, 14, 1, l);
  SensorHealth h = Sensors::health();
  snprintf(l, sizeof(l), "ToF: %s %dmm", h.tofPresent ? "ok" : "--", Sensors::presenceMm());
  Display::text(0, 26, 1, l);
  snprintf(l, sizeof(l), "Mic: %d%%", (int)(Sensors::noise() * 100));  Display::text(0, 38, 1, l);
  snprintf(l, sizeof(l), "WiFi:%s  v%s", Cloud::online() ? "on" : "off", FW_VERSION);
  Display::text(0, 50, 1, l);
  Display::show();
}

namespace StateMachine {

void init() {
  s_bootAt = millis();
  s_cfg = Storage::loadConfig(defaultConfig());
  Haptics::setEnabled(s_cfg.hapticsEnabled);
  s_dur = Storage::lastDurationMin();
  Inputs::setMinutes(s_dur);
  // optional: pull fresh settings from the site (no-op until ENABLE_CLOUD)
  DeviceConfig fromCloud;
  if (Cloud::fetchConfig(fromCloud)) applyConfig(fromCloud);
  enter(ST_IDLE);
}

void tick() {
  Inputs::poll();
  int  btn = Inputs::button();
  bool rot = Inputs::rotated();
  bool clk = Inputs::knobClicked();
  if (rot) s_dur = Inputs::minutes();
#if USE_SPDT_TOGGLE
  s_mode = Inputs::spdtPresentWork() ? MODE_WORK : MODE_BREAK;
#endif
  uint32_t now = millis();
  bool warm = (now - s_bootAt) > SENSOR_WARMUP_MS;   // Story 18: settle sensors

  switch (s_state) {
    case ST_IDLE:
      if (rot)        enter(ST_SETUP);
      else if (clk)   cycleMode();
      else if (btn == 2) enter(ST_DIAG);             // long-press -> monitor screen
      break;

    case ST_SETUP:
      if (rot)        { s_uiDirty = true; s_stateAt = now; Haptics::click(); }
      else if (clk)   { Haptics::tap(); enter(ST_ARMED); }
      else if (now - s_stateAt > SETUP_TIMEOUT_MS) enter(ST_IDLE);
      break;

    case ST_ARMED:
      if (btn == 1)   startSession();
      else if (clk)   cycleMode();
      else if (rot)   enter(ST_SETUP);
      else if (now - s_stateAt > SETUP_TIMEOUT_MS) enter(ST_IDLE);
      break;

    case ST_RUNNING:
      if (Sensors::faulted()) { enter(ST_ERROR); break; }
      if (btn == 2)           { Haptics::reset(); endSession("aborted"); break; }
      if (btn == 1)           { Session::addBreak(); Haptics::pause(); enter(ST_PAUSED); break; }
      if (warm && !Sensors::present() && Sensors::absentForMs() > PRESENCE_PAUSE_MS) {
        Session::addPresenceInterruption(); Haptics::pause(); enter(ST_PAUSED); break;
      }
      Session::tick(Sensors::present());
      if (s_cfg.adaptiveCoaching && s_mode == MODE_WORK && Session::lastFle() > FLE_ADAPTIVE_BREAK) {
        Haptics::pause();   // Story 16: suggest-a-break cue
      }
      if (Session::finished()) { enter(ST_COMPLETE); break; }
      s_uiDirty = true;     // refresh countdown
      break;

    case ST_PAUSED:
      if (btn == 2)                       { Haptics::reset(); endSession("interrupted"); break; }
      if (btn == 1 || Sensors::present()) { Session::markResumed(); Haptics::resume(); enter(ST_RUNNING); break; }
      if (Sensors::absentForMs() > PRESENCE_END_MS) { endSession("interrupted"); break; }
      break;

    case ST_COMPLETE:
      endSession("completed");
      break;

    case ST_DIAG:
      if (btn == 1 || btn == 2) enter(ST_IDLE);
      s_uiDirty = true;
      break;

    case ST_ERROR:
      if (btn == 2) enter(ST_IDLE);   // reset/fix
      break;

    default: break;
  }

  // render at ~5Hz or whenever something changed
  if (s_uiDirty || now - s_lastRender > 200) {
    if (s_state == ST_DIAG) renderDiag();
    else                    Display::render(buildModel());
    LedRing::show(s_state, s_mode, fracRemaining());
    s_lastRender = now; s_uiDirty = false;
  }
}

SysState state()       { return s_state; }
Mode     mode()        { return s_mode; }
int      durationMin() { return s_dur; }

const DeviceConfig& config() { return s_cfg; }

void applyConfig(const DeviceConfig& c) {
  s_cfg = c;
  Haptics::setEnabled(c.hapticsEnabled);
  Storage::saveConfig(c);
  s_uiDirty = true;
}

} // namespace StateMachine
