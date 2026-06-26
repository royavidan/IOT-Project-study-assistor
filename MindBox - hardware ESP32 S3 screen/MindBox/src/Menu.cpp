#include "Menu.h"
#include "config.h"
#include "Inputs.h"
#include "Haptics.h"
#include "Sound.h"
#include "Storage.h"
#include "Theme.h"
#include "Panel.h"
#include "Cloud.h"
#include <Arduino.h>

enum Screen {
  SCR_ROOT,
  SCR_MODE,
  SCR_WORK_DUR,
  SCR_BREAK_DUR,
  SCR_LONGBREAK,
  SCR_SETTINGS,
  SCR_DISPLAY,
  SCR_PRESENCE,
  SCR_COACHING,
  SCR_QUIET,
  SCR_ALERTS,
  SCR_STATS,
  SCR_STATS_HISTORY,
  SCR_GOAL,
  SCR_DEVICE,
  SCR_DEVICE_INFO,
  SCR_FACTORY_CONFIRM,
  SCR_ABOUT,
};

static Mode*          s_mode = nullptr;
static int*           s_work = nullptr;
static int*           s_break = nullptr;
static int*           s_cycles = nullptr;
static DeviceConfig*  s_cfg  = nullptr;
static bool           s_wifi = false, s_paired = false;
static const char*    s_devId = "";

static Screen s_screen = SCR_ROOT;
static Screen s_stack[8];
static int    s_depth = 0;
static int    s_cursor = 0;
static int    s_scroll = 0;
static int    s_durBackup = DUR_DEFAULT_MIN;
static int    s_goalBackup = GOAL_DEFAULT_MIN;
static int*   s_durEdit = nullptr;
static bool   s_dirty = true;

static int      s_pauseCursor = 0;
static bool     s_runningMenu = false;
static int      s_runCursor = 0;
static int      s_runLevel  = 0;     // 0 = top overlay, 1 = in-session Settings list
static int      s_setCursor = 0;     // cursor within the Settings list
static int      s_setScroll = 0;     // scroll offset for the Settings list

static int      s_resumeCursor = 0;
static int      s_resumeRemainMin = 0;
static Mode     s_resumeMode = MODE_WORK;
static bool     s_resumeSetActive = false;
static int      s_resumeFocusDone = 0;
static int      s_resumeCycleTotal = 0;

static int      s_cycleCursor = 0;
static Mode     s_cycleNextMode = MODE_BREAK;
static int      s_cycleNextMin = 5;
static int      s_cycleFocusDone = 0;
static int      s_cycleTotal = 4;

static PauseReason s_pauseReason = PAUSE_MANUAL;

static void markDirty() { s_dirty = true; }

// Honest connection state: Wi-Fi link is NOT the same as internet/backend.
//   offline   = no Wi-Fi link
//   no net    = Wi-Fi up but no internet (NTP never synced)
//   no server = internet ok but the backend didn't answer (wrong URL / port blocked / down)
//   online    = backend reachable (unpaired)   ·   synced = backend reachable + paired
static const char* connWord() {
  if (!s_wifi) return "offline";
  if (Cloud::serverReachable()) return s_paired ? "synced" : "online";
  if (Cloud::haveClock())       return "no server";
  return "no net";
}

static const char* pauseAfterLabel(uint8_t idx) {
  switch (idx > 2 ? 0 : idx) {
    case 0:  return "30s";
    case 1:  return "1m";
    default: return "2m";
  }
}

static const char* endAwayLabel(uint8_t idx) {
  switch (idx > 2 ? 0 : idx) {
    case 0:  return "5m";
    case 1:  return "10m";
    default: return "Off";
  }
}

static void push(Screen s) {
  if (s_depth < 8) s_stack[s_depth++] = s_screen;
  s_screen = s;
  s_cursor = 0;
  s_scroll = 0;
  markDirty();
}

static void pop() {
  if (s_depth > 0) {
    s_screen = s_stack[--s_depth];
    s_cursor = 0;
    s_scroll = 0;
    Inputs::setInputMode(INPUT_MENU);
    markDirty();
  }
}

static void popToRoot() {
  s_depth = 0;
  s_screen = SCR_ROOT;
  s_cursor = 0;
  s_scroll = 0;
  Inputs::setInputMode(INPUT_MENU);
  markDirty();
}

static void saveDurations() {
  Storage::setWorkDuration(*s_work);
  Storage::setBreakDuration(*s_break);
}

enum PresetKind { PRESET_CUSTOM, PRESET_FOCUS25, PRESET_DEEP };

static PresetKind activePreset() {
  if (*s_work == 25 && *s_break == 5 && *s_cycles == 4) return PRESET_FOCUS25;
  if (*s_work == 50 && *s_break == 10) return PRESET_DEEP;
  return PRESET_CUSTOM;
}

static void appendPresetMark(char* buf, size_t n, bool active) {
  if (!active) return;
  size_t len = strlen(buf);
  if (len + 1 < n) {
    buf[len] = '*';
    buf[len + 1] = 0;
  }
}

static void formatCycle(char* buf, size_t n) {
  snprintf(buf, n, "%d/%d", *s_work, *s_break);
}

static void formatMin(char* buf, size_t n, int m) {
  snprintf(buf, n, "%dm", m);
}

static void formatStartVal(char* buf, size_t n) {
  snprintf(buf, n, "%dm x%d", *s_work, *s_cycles);
}

static void formatModeVal(char* buf, size_t n) {
  switch (activePreset()) {
    case PRESET_FOCUS25:
      snprintf(buf, n, "F25 25/5x4");
      break;
    case PRESET_DEEP:
      snprintf(buf, n, "50/10 x%d", *s_cycles);
      appendPresetMark(buf, n, true);
      break;
    default:
      snprintf(buf, n, "%d/%d x%d", *s_work, *s_break, *s_cycles);
      break;
  }
}

static void fillModeInfoLine(MenuView& v) {
  switch (activePreset()) {
    case PRESET_FOCUS25:
      strncpy(v.infoLine, "Focus 25 preset", sizeof(v.infoLine) - 1);
      break;
    case PRESET_DEEP:
      strncpy(v.infoLine, "Deep · any cycles", sizeof(v.infoLine) - 1);
      break;
    default:
      snprintf(v.infoLine, sizeof(v.infoLine), "Custom %d/%d x%d",
               *s_work, *s_break, *s_cycles);
      break;
  }
}

static void formatTodayProgress(char* buf, size_t n) {
  int tm = (int)(Storage::todayDisplaySec() / 60);
  int gm = (int)s_cfg->dailyGoalMin;
  snprintf(buf, n, "%dm / %dm", tm, gm);
}

static void formatTodayShort(char* buf, size_t n) {
  int tm = (int)(Storage::todayDisplaySec() / 60);
  int gm = (int)s_cfg->dailyGoalMin;
  snprintf(buf, n, "%d/%dm", tm, gm);
}

static void openGoalEditor() {
  s_goalBackup = (int)s_cfg->dailyGoalMin;
  Inputs::setInputMode(INPUT_DURATION);
  Inputs::setMinutes(s_goalBackup);
  push(SCR_GOAL);
}

static void cycleSetCount() {
  (*s_cycles)++;
  if (*s_cycles > CYCLE_MAX) *s_cycles = CYCLE_MIN;
  Storage::setCycleCount(*s_cycles);
  Haptics::click();
  markDirty();
}

static void applyPreset(int work, int brk) {
  *s_work = work;
  *s_break = brk;
  *s_mode = MODE_WORK;
  if (work == 25 && brk == 5) *s_cycles = 4;
  saveDurations();
  Storage::setCycleCount(*s_cycles);
  Inputs::setMinutes(work);
}

static int itemCount(Screen s) {
  switch (s) {
    case SCR_ROOT:     return 5;
    case SCR_MODE:     return 8;   // presets · focus · break · cycles · long-break · every · auto-start
    case SCR_SETTINGS: return 6;   // Presence · Display · Coaching · Stats · Quiet · Environment
    case SCR_DISPLAY:  return 9;   // Show timer · Haptics · Strength · Sound · Volume · Brightness · Theme · Test motor · Test sound
    case SCR_PRESENCE: return 3;
    case SCR_COACHING: return 4;
    case SCR_QUIET:    return 3;   // Enabled · From · To
    case SCR_ALERTS:   return 10;  // temp(+min/max) · noise(+max) · light(+min/max) · away · nudge
    case SCR_STATS:         return 8;
    case SCR_STATS_HISTORY: {
      int n = Storage::sessionLogCount();
      return n > 0 ? n : 1;
    }
    case SCR_DEVICE:      return 6; // Pair · Info · Wi-Fi · Sync now · Diagnostics · Factory reset
    case SCR_DEVICE_INFO: return 12;
    case SCR_FACTORY_CONFIRM: return 2;
    case SCR_ABOUT:    return 0;   // info-only; back via chip/long-press
    default:           return 0;
  }
}

static void clampScroll(int count) {
  if (s_cursor < 0) s_cursor = count - 1;
  if (s_cursor >= count) s_cursor = 0;
  if (s_cursor < s_scroll) s_scroll = s_cursor;
  if (s_cursor >= s_scroll + MENU_VISIBLE_ROWS) s_scroll = s_cursor - MENU_VISIBLE_ROWS + 1;
}

static void moveCursor(int dir, int count) {
  if (count <= 0) return;
  s_cursor += dir;
  clampScroll(count);
  Haptics::click();
  markDirty();
}

static void toggleShowTimer() {
  s_cfg->showTimer = !s_cfg->showTimer;
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void toggleHaptics() {
  s_cfg->hapticsEnabled = !s_cfg->hapticsEnabled;
  Haptics::setEnabled(s_cfg->hapticsEnabled);
  Storage::saveConfig(*s_cfg);
  if (s_cfg->hapticsEnabled) Haptics::enableTest();
  markDirty();
}

static void toggleTheme() {
  Theme::toggle();
  Storage::setDarkTheme(Theme::isDark());   // remember across reboots
  Haptics::click();
  markDirty();
}

static void toggleAutoPause() {
  s_cfg->autoPause = !s_cfg->autoPause;
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void toggleAdaptive() {
  s_cfg->adaptiveCoaching = !s_cfg->adaptiveCoaching;
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void toggleCoachingNudgeScreen() {
  s_cfg->coachingNudgeScreen = !s_cfg->coachingNudgeScreen;
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void toggleCoachingNudgeHaptic() {
  s_cfg->coachingNudgeHaptic = !s_cfg->coachingNudgeHaptic;
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void toggleCoachingAutoPause() {
  s_cfg->coachingAutoPause = !s_cfg->coachingAutoPause;
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void cyclePauseAfter() {
  s_cfg->presencePauseIdx = (s_cfg->presencePauseIdx + 1) % 3;
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void cycleEndAway() {
  s_cfg->presenceEndIdx = (s_cfg->presenceEndIdx + 1) % 3;
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

// --- new feature helpers ----------------------------------------------------
static void toggleAutoStart() {
  s_cfg->autoStartCycle = !s_cfg->autoStartCycle;
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

// Long break every N focus blocks: cycle 2,3,4,5,6, then Off (every=0).
static void cycleLongBreakEvery() {
  uint8_t e = s_cfg->longBreakEvery;
  e = (e >= 6) ? 0 : (e < 2 ? 2 : e + 1);
  s_cfg->longBreakEvery = e;
  s_cfg->longBreakEnabled = (e > 0);
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static const char* hapticLevelLabel(uint8_t l) {
  return l == 0 ? "Low" : (l == 1 ? "Med" : "High");
}

static void cycleHapticLevel() {
  s_cfg->hapticLevel = (s_cfg->hapticLevel + 1) % 3;
  Haptics::setLevel(s_cfg->hapticLevel);
  Storage::saveConfig(*s_cfg);
  Haptics::enableTest();        // buzz at the new strength
  markDirty();
}

static const char* soundLevelLabel(uint8_t l) {
  return l == 0 ? "Low" : (l == 1 ? "Med" : "High");
}

static void toggleSound() {
  s_cfg->soundEnabled = !s_cfg->soundEnabled;
  Sound::setEnabled(s_cfg->soundEnabled);
  Storage::saveConfig(*s_cfg);
  if (s_cfg->soundEnabled) Sound::test();   // confirm chime when enabled
  markDirty();
}

static void cycleSoundLevel() {
  s_cfg->soundLevel = (s_cfg->soundLevel + 1) % 3;
  Sound::setVolume(s_cfg->soundLevel);
  Storage::saveConfig(*s_cfg);
  Sound::test();                // play a chime at the new volume
  markDirty();
}

static void cycleBrightness() {
  // 25 -> 50 -> 75 -> 100 -> 25
  int b = s_cfg->brightnessPct;
  b = (b >= 100) ? 25 : (b < 25 ? 25 : b + 25);
  s_cfg->brightnessPct = (uint8_t)b;
  s_cfg->autoBrightness = false;   // manual override: stop the light sensor from driving the backlight
  Panel::setBrightness(b);      // apply live
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void toggleAutoBrightness() {
  s_cfg->autoBrightness = !s_cfg->autoBrightness;
  if (!s_cfg->autoBrightness) Panel::setBrightness(s_cfg->brightnessPct);  // back to the manual level
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void fmtHHMM(char* buf, size_t n, uint16_t mins) {
  if (mins == 0xFFFF) { snprintf(buf, n, "--:--"); return; }
  snprintf(buf, n, "%02u:%02u", (mins / 60) % 24, mins % 60);
}

static bool quietEnabled() { return s_cfg->quietStartMin != 0xFFFF; }

static void toggleQuiet() {
  if (quietEnabled()) { s_cfg->quietStartMin = 0xFFFF; s_cfg->quietEndMin = 0xFFFF; }
  else                { s_cfg->quietStartMin = 1320; s_cfg->quietEndMin = 420; } // 22:00–07:00
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void cycleQuietFrom() {
  if (!quietEnabled()) return;
  s_cfg->quietStartMin = (uint16_t)((s_cfg->quietStartMin + 30) % 1440);
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

static void cycleQuietTo() {
  if (!quietEnabled()) return;
  s_cfg->quietEndMin = (uint16_t)((s_cfg->quietEndMin + 30) % 1440);
  Storage::saveConfig(*s_cfg);
  Haptics::click();
  markDirty();
}

// --- environment-alert helpers (toggles + cycle-on-tap thresholds) ----------
static void saveCfgClick() { Storage::saveConfig(*s_cfg); Haptics::click(); markDirty(); }

static void toggleAlertTemp()  { s_cfg->alertTemp  = !s_cfg->alertTemp;  saveCfgClick(); }
static void toggleAlertNoise() { s_cfg->alertNoise = !s_cfg->alertNoise; saveCfgClick(); }
static void toggleAlertLight() { s_cfg->alertLight = !s_cfg->alertLight; saveCfgClick(); }
static void toggleAlertAway()  { s_cfg->alertPresence = !s_cfg->alertPresence; saveCfgClick(); }
static void toggleAlertNudge() { s_cfg->alertNudge = !s_cfg->alertNudge; saveCfgClick(); }

static void cycleTempMin() {  // 14..22 step 2
  int v = s_cfg->tempMinC + 2; if (v > 22) v = 14;
  s_cfg->tempMinC = (int8_t)v; saveCfgClick();
}
static void cycleTempMax() {  // 24..30 step 2
  int v = s_cfg->tempMaxC + 2; if (v > 30) v = 24;
  s_cfg->tempMaxC = (int8_t)v; saveCfgClick();
}
static void cycleNoiseMax() { // 40..80 dB step 10
  int v = s_cfg->noiseMaxDb + 10; if (v > 80) v = 40;
  s_cfg->noiseMaxDb = (uint8_t)v; saveCfgClick();
}
static void cycleLightMin() { // 0..200 step 50
  int v = s_cfg->lightMinLux + 50; if (v > 200) v = 0;
  s_cfg->lightMinLux = (uint16_t)v; saveCfgClick();
}
static void cycleLightMax() { // 500..2000 step 250
  int v = s_cfg->lightMaxLux + 250; if (v > 2000) v = 500;
  s_cfg->lightMaxLux = (uint16_t)v; saveCfgClick();
}

static int  s_lbBackup = 15;
static void openLongBreakEditor() {
  s_lbBackup = (int)s_cfg->longBreakMin;
  Inputs::setInputMode(INPUT_DURATION);
  Inputs::setMinutes(s_lbBackup);
  push(SCR_LONGBREAK);
}

static void openDurEditor(int* ptr, Screen scr) {
  s_durEdit = ptr;
  s_durBackup = *ptr;
  Inputs::setInputMode(INPUT_DURATION);
  Inputs::setMinutes(*ptr);
  push(scr);
}

namespace Menu {

void begin(Mode* mode, int* workMin, int* breakMin, int* cycleCount, DeviceConfig* cfg) {
  s_mode   = mode;
  s_work   = workMin;
  s_break  = breakMin;
  s_cycles = cycleCount;
  s_cfg    = cfg;
  resetToRoot();
}

void setContext(bool wifi, bool paired, const char* deviceId) {
  s_wifi   = wifi;
  s_paired = paired;
  s_devId  = deviceId ? deviceId : "";
}

void invalidate() { markDirty(); }

void setLiveFocusSec(uint32_t sec) {
  Storage::setLiveFocusSec(sec);
  markDirty();
}

int activeDurationMin() {
  return (*s_mode == MODE_WORK) ? *s_work : *s_break;
}

void resetToRoot() {
  s_runningMenu = false;
  popToRoot();
  s_cursor = 0;
  Inputs::setInputMode(INPUT_MENU);
}

MenuAction tick(int rotDir, int sideBtn) {
  if (s_screen == SCR_GOAL) {
    if (sideBtn == 2) {
      s_cfg->dailyGoalMin = (uint16_t)s_goalBackup;
      pop();
      Haptics::click();
      return MENU_NONE;
    }
    if (rotDir != 0) {
      int next = (int)s_cfg->dailyGoalMin + rotDir * GOAL_STEP_MIN;
      if (next < GOAL_MIN_MIN) next = GOAL_MIN_MIN;
      if (next > GOAL_MAX_MIN) next = GOAL_MAX_MIN;
      if (next != (int)s_cfg->dailyGoalMin) {
        s_cfg->dailyGoalMin = (uint16_t)next;
        Inputs::setMinutes(next);
        Haptics::click();
        markDirty();
      }
    }
    if (sideBtn == 1) {
      Storage::saveConfig(*s_cfg);
      Haptics::tap();
      pop();
    }
    return MENU_NONE;
  }

  if (s_screen == SCR_LONGBREAK) {
    if (sideBtn == 2) {
      s_cfg->longBreakMin = (uint16_t)s_lbBackup;
      pop();
      Haptics::click();
      return MENU_NONE;
    }
    if (rotDir != 0) {
      int next = (int)s_cfg->longBreakMin + rotDir * DUR_STEP_MIN;
      if (next < DUR_MIN_MIN) next = DUR_MIN_MIN;
      if (next > 60) next = 60;
      if (next != (int)s_cfg->longBreakMin) {
        s_cfg->longBreakMin = (uint16_t)next;
        Inputs::setMinutes(next);
        Haptics::click();
        markDirty();
      }
    }
    if (sideBtn == 1) {
      Storage::saveConfig(*s_cfg);
      Haptics::tap();
      pop();
    }
    return MENU_NONE;
  }

  if (s_screen == SCR_WORK_DUR || s_screen == SCR_BREAK_DUR) {
    if (sideBtn == 2) {
      *s_durEdit = s_durBackup;
      Inputs::setMinutes(*s_durEdit);
      pop();
      Haptics::click();
      return MENU_NONE;
    }
    if (rotDir != 0) {
      int next = *s_durEdit + rotDir * DUR_STEP_MIN;
      if (next < DUR_MIN_MIN) next = DUR_MIN_MIN;
      if (next > DUR_MAX_MIN) next = DUR_MAX_MIN;
      if (next != *s_durEdit) {
        *s_durEdit = next;
        Inputs::setMinutes(*s_durEdit);
        Haptics::click();
        markDirty();
      }
    }
    if (sideBtn == 1) {
      saveDurations();
      Haptics::tap();
      pop();
    }
    return MENU_NONE;
  }

  if (sideBtn == 2) {
    if (s_screen != SCR_ROOT) {
      pop();
      Haptics::click();
    }
    return MENU_NONE;
  }

  int count = itemCount(s_screen);
  if (rotDir != 0) moveCursor(rotDir, count);

  if (sideBtn != 1) return MENU_NONE;

  switch (s_screen) {
    case SCR_ROOT:
      switch (s_cursor) {
        case 0: return MENU_START_SESSION;
        case 1: push(SCR_MODE); break;
        case 2: push(SCR_SETTINGS); break;
        case 3: push(SCR_DEVICE); break;
        case 4: push(SCR_ABOUT); break;
      }
      Haptics::tap();
      markDirty();
      break;

    case SCR_MODE:
      switch (s_cursor) {
        case 0: applyPreset(25, 5); popToRoot(); break;
        case 1: applyPreset(50, 10); popToRoot(); break;
        case 2: openDurEditor(s_work, SCR_WORK_DUR); break;
        case 3: openDurEditor(s_break, SCR_BREAK_DUR); break;
        case 4: cycleSetCount(); break;
        case 5: openLongBreakEditor(); break;
        case 6: cycleLongBreakEvery(); break;
        case 7: toggleAutoStart(); break;
      }
      Haptics::tap();
      markDirty();
      break;

    case SCR_SETTINGS:
      switch (s_cursor) {
        case 0: push(SCR_PRESENCE); break;
        case 1: push(SCR_DISPLAY); break;
        case 2: push(SCR_COACHING); break;
        case 3: push(SCR_STATS); break;
        case 4: push(SCR_QUIET); break;
        case 5: push(SCR_ALERTS); break;
      }
      Haptics::tap();
      markDirty();
      break;

    case SCR_DISPLAY:
      if (s_cursor == 0) toggleShowTimer();
      else if (s_cursor == 1) toggleHaptics();
      else if (s_cursor == 2) cycleHapticLevel();
      else if (s_cursor == 3) toggleSound();
      else if (s_cursor == 4) cycleSoundLevel();
      else if (s_cursor == 5) cycleBrightness();
      else if (s_cursor == 6) toggleTheme();
      else if (s_cursor == 7) {
        Serial.println("[menu] Test motor selected");
        Haptics::testPulse();
      } else {
        Serial.println("[menu] Test sound selected");
        Sound::test();
      }
      markDirty();
      break;

    case SCR_QUIET:
      if (s_cursor == 0) toggleQuiet();
      else if (s_cursor == 1) cycleQuietFrom();
      else cycleQuietTo();
      break;

    case SCR_ALERTS:
      switch (s_cursor) {
        case 0: toggleAlertTemp();  break;
        case 1: cycleTempMin();     break;
        case 2: cycleTempMax();     break;
        case 3: toggleAlertNoise(); break;
        case 4: cycleNoiseMax();    break;
        case 5: toggleAlertLight(); break;
        case 6: cycleLightMin();    break;
        case 7: cycleLightMax();    break;
        case 8: toggleAlertAway();  break;
        case 9: toggleAlertNudge(); break;
      }
      break;

    case SCR_PRESENCE:
      if (s_cursor == 0) toggleAutoPause();
      else if (s_cursor == 1) cyclePauseAfter();
      else if (s_cursor == 2) cycleEndAway();
      break;

    case SCR_COACHING:
      if (s_cursor == 0) toggleAdaptive();
      else if (s_cursor == 1) toggleCoachingNudgeScreen();
      else if (s_cursor == 2) toggleCoachingNudgeHaptic();
      else toggleCoachingAutoPause();
      break;

    case SCR_STATS:
      if (s_cursor == 5) push(SCR_STATS_HISTORY);
      else if (s_cursor == 6) openGoalEditor();
      else if (s_cursor == 7) {
        Storage::resetToday();
        Haptics::tap();
        markDirty();
      } else {
        Haptics::click();
      }
      break;

    case SCR_STATS_HISTORY:
      Haptics::click();
      break;

    case SCR_DEVICE:
      if (s_cursor == 0) return s_paired ? MENU_SIGN_OUT : MENU_ENTER_PAIRING;
      if (s_cursor == 1) { push(SCR_DEVICE_INFO); Haptics::tap(); markDirty(); break; }
      if (s_cursor == 2) return MENU_ENTER_WIFI_SETUP;
      if (s_cursor == 3) return MENU_SYNC_NOW;
      if (s_cursor == 4) return MENU_ENTER_DIAGNOSTICS;
      if (s_cursor == 5) { push(SCR_FACTORY_CONFIRM); Haptics::tap(); markDirty(); break; }
      break;

    case SCR_DEVICE_INFO:
      Haptics::click();
      break;

    case SCR_FACTORY_CONFIRM:
      if (s_cursor == 0) { pop(); Haptics::click(); }
      else return MENU_FACTORY_RESET;
      break;

    default: break;
  }
  return MENU_NONE;
}

static void fillRow(MenuRow& r, const char* label, const char* val, bool sel,
                    uint8_t icon = MI_NONE, bool chevron = false) {
  strncpy(r.label, label, sizeof(r.label) - 1);
  r.label[sizeof(r.label) - 1] = 0;
  r.hasValue = (val != nullptr);
  if (val) {
    strncpy(r.value, val, sizeof(r.value) - 1);
    r.value[sizeof(r.value) - 1] = 0;
  } else {
    r.value[0] = 0;
  }
  r.selected = sel;
  r.icon = icon;
  r.chevron = chevron;
}

const MenuView& view() {
  static MenuView v;
  memset(&v, 0, sizeof(v));

  if (s_screen == SCR_WORK_DUR || s_screen == SCR_BREAK_DUR) {
    v.durationEditor = true;
    v.durationMin = *s_durEdit;
    v.durationFrac = (float)(*s_durEdit - DUR_MIN_MIN) / (float)(DUR_MAX_MIN - DUR_MIN_MIN);
    strncpy(v.title, s_screen == SCR_WORK_DUR ? "FOCUS" : "BREAK",
            sizeof(v.title) - 1);
    return v;
  }

  if (s_screen == SCR_GOAL) {
    v.durationEditor = true;
    v.durationMin = (int)s_cfg->dailyGoalMin;
    v.durationFrac = (float)((int)s_cfg->dailyGoalMin - GOAL_MIN_MIN)
                     / (float)(GOAL_MAX_MIN - GOAL_MIN_MIN);
    strncpy(v.title, "DAILY GOAL", sizeof(v.title) - 1);
    return v;
  }

  if (s_screen == SCR_LONGBREAK) {
    v.durationEditor = true;
    v.durationMin = (int)s_cfg->longBreakMin;
    v.durationFrac = (float)((int)s_cfg->longBreakMin - DUR_MIN_MIN) / (float)(60 - DUR_MIN_MIN);
    strncpy(v.title, "LONG BREAK", sizeof(v.title) - 1);
    return v;
  }

  v.durationEditor = false;
  v.showBrand = (s_screen == SCR_ROOT);
  if (v.showBrand) {
    strncpy(v.title, "MindBox", sizeof(v.title) - 1);
  } else {
    // Indexed by the Screen enum — keep in lock-step with it (editors included).
    const char* titles[] = {
      "MindBox", "MODE", "WORK MIN", "BREAK MIN", "LONG BREAK", "SETTINGS",
      "DISPLAY", "PRESENCE", "COACHING", "QUIET HOURS", "ENVIRONMENT", "STATS",
      "HISTORY", "GOAL", "DEVICE", "DEVICE INFO", "FACTORY RESET", "ABOUT"
    };
    strncpy(v.title, titles[s_screen], sizeof(v.title) - 1);
  }
  if (s_screen == SCR_ROOT)
    formatTodayShort(v.statusWord, sizeof(v.statusWord));
  else
    strncpy(v.statusWord, connWord(), sizeof(v.statusWord) - 1);

  char buf[16];
  int count = itemCount(s_screen);
  clampScroll(count);
  v.rowCount = 0;

  if (s_screen == SCR_MODE)
    fillModeInfoLine(v);

  for (int i = 0; i < MENU_VISIBLE_ROWS; i++) {
    int idx = s_scroll + i;
    if (idx >= count) break;
    bool sel = (idx == s_cursor);
    MenuRow& row = v.rows[v.rowCount++];

    switch (s_screen) {
      case SCR_ROOT:
        switch (idx) {
          case 0:
            formatStartVal(buf, sizeof(buf));
            fillRow(row, "Start", buf, sel, MI_START);
            break;
          case 1:
            formatModeVal(buf, sizeof(buf));
            fillRow(row, "Mode", buf, sel, MI_MODE, true);
            break;
          case 2: fillRow(row, "Settings", nullptr, sel, MI_SETTINGS, true); break;
          case 3: fillRow(row, "Device", connWord(), sel, MI_DEVICE, true); break;
          case 4: fillRow(row, "About", FW_VERSION, sel, MI_ABOUT, true); break;
        }
        break;

      case SCR_MODE:
        switch (idx) {
          case 0:
            snprintf(buf, sizeof(buf), "25/5");
            appendPresetMark(buf, sizeof(buf), activePreset() == PRESET_FOCUS25);
            fillRow(row, "Focus 25", buf, sel);
            break;
          case 1:
            snprintf(buf, sizeof(buf), "50/10");
            appendPresetMark(buf, sizeof(buf), activePreset() == PRESET_DEEP);
            fillRow(row, "Deep 50/10", buf, sel);
            break;
          case 2:
            formatMin(buf, sizeof(buf), *s_work);
            fillRow(row, "Focus time", buf, sel);
            break;
          case 3:
            formatMin(buf, sizeof(buf), *s_break);
            fillRow(row, "Break time", buf, sel);
            break;
          case 4: {
            char cbuf[8];
            snprintf(cbuf, sizeof(cbuf), "%d", *s_cycles);
            fillRow(row, "Cycles", cbuf, sel);
            break;
          }
          case 5: {
            char b[8];
            if (s_cfg->longBreakEnabled && s_cfg->longBreakEvery > 0)
              snprintf(b, sizeof(b), "%dm", (int)s_cfg->longBreakMin);
            else snprintf(b, sizeof(b), "off");
            fillRow(row, "Long break", b, sel);
            break;
          }
          case 6: {
            char b[8];
            if (s_cfg->longBreakEnabled && s_cfg->longBreakEvery > 0)
              snprintf(b, sizeof(b), "%dx", s_cfg->longBreakEvery);
            else snprintf(b, sizeof(b), "off");
            fillRow(row, "Every", b, sel);
            break;
          }
          case 7: fillRow(row, "Auto-start", s_cfg->autoStartCycle ? "ON" : "OFF", sel); break;
        }
        break;

      case SCR_SETTINGS:
        switch (idx) {
          case 0: fillRow(row, "Presence", nullptr, sel, MI_PRESENCE, true); break;
          case 1: fillRow(row, "Display", nullptr, sel, MI_DISPLAY, true); break;
          case 2: fillRow(row, "Coaching", nullptr, sel, MI_COACHING, true); break;
          case 3: fillRow(row, "Stats", nullptr, sel, MI_STATS, true); break;
          case 4: fillRow(row, "Quiet hours", quietEnabled() ? "ON" : "OFF", sel, MI_NONE, true); break;
          case 5: fillRow(row, "Environment", nullptr, sel, MI_PRESENCE, true); break;
        }
        break;

      case SCR_DISPLAY:
        if (idx == 0) fillRow(row, "Show timer", s_cfg->showTimer ? "ON" : "OFF", sel);
        else if (idx == 1) fillRow(row, "Haptics", s_cfg->hapticsEnabled ? "ON" : "OFF", sel);
        else if (idx == 2) fillRow(row, "Strength", hapticLevelLabel(s_cfg->hapticLevel), sel);
        else if (idx == 3) fillRow(row, "Sound", s_cfg->soundEnabled ? "ON" : "OFF", sel);
        else if (idx == 4) fillRow(row, "Volume", soundLevelLabel(s_cfg->soundLevel), sel);
        else if (idx == 5) { char b[8]; snprintf(b, sizeof(b), "%d%%", s_cfg->brightnessPct);
                             fillRow(row, "Brightness", b, sel); }
        else if (idx == 6) fillRow(row, "Theme", Theme::isDark() ? "Dark" : "Light", sel);
        else if (idx == 7) fillRow(row, "Test motor", Haptics::isHolding() ? "MAX..." : "press", sel);
        else fillRow(row, "Test sound", "press", sel);
        break;

      case SCR_QUIET:
        if (idx == 0) fillRow(row, "Enabled", quietEnabled() ? "ON" : "OFF", sel);
        else if (idx == 1) { char b[8]; fmtHHMM(b, sizeof(b), s_cfg->quietStartMin);
                             fillRow(row, "From", b, sel); }
        else { char b[8]; fmtHHMM(b, sizeof(b), s_cfg->quietEndMin);
               fillRow(row, "To", b, sel); }
        break;

      case SCR_ALERTS: {
        char b[10];
        switch (idx) {
          case 0: fillRow(row, "Temperature", s_cfg->alertTemp ? "ON" : "OFF", sel); break;
          case 1: snprintf(b, sizeof(b), "%dC", s_cfg->tempMinC); fillRow(row, "Temp min", b, sel); break;
          case 2: snprintf(b, sizeof(b), "%dC", s_cfg->tempMaxC); fillRow(row, "Temp max", b, sel); break;
          case 3: fillRow(row, "Noise", s_cfg->alertNoise ? "ON" : "OFF", sel); break;
          case 4: snprintf(b, sizeof(b), "%ddB", s_cfg->noiseMaxDb); fillRow(row, "Noise max", b, sel); break;
          case 5: fillRow(row, "Light", s_cfg->alertLight ? "ON" : "OFF", sel); break;
          case 6: snprintf(b, sizeof(b), "%dlx", s_cfg->lightMinLux); fillRow(row, "Light min", b, sel); break;
          case 7: snprintf(b, sizeof(b), "%dlx", s_cfg->lightMaxLux); fillRow(row, "Light max", b, sel); break;
          case 8: fillRow(row, "Away", s_cfg->alertPresence ? "ON" : "OFF", sel); break;
          default: fillRow(row, "Nudge", s_cfg->alertNudge ? "ON" : "OFF", sel); break;
        }
        break;
      }

      case SCR_PRESENCE:
        if (idx == 0) fillRow(row, "Auto-pause", s_cfg->autoPause ? "ON" : "OFF", sel);
        else if (idx == 1) fillRow(row, "Pause after", pauseAfterLabel(s_cfg->presencePauseIdx), sel);
        else fillRow(row, "End if away", endAwayLabel(s_cfg->presenceEndIdx), sel);
        break;

      case SCR_COACHING:
        if (idx == 0) fillRow(row, "Adaptive", s_cfg->adaptiveCoaching ? "ON" : "OFF", sel);
        else if (idx == 1) fillRow(row, "Nudge screen", s_cfg->coachingNudgeScreen ? "ON" : "OFF", sel);
        else if (idx == 2) fillRow(row, "Nudge haptic", s_cfg->coachingNudgeHaptic ? "ON" : "OFF", sel);
        else fillRow(row, "Auto-pause", s_cfg->coachingAutoPause ? "ON" : "OFF", sel);
        break;

      case SCR_STATS: {
        SessionLogEntry last = Storage::lastSessionLog();
        if (idx == 0) {
          formatTodayProgress(buf, sizeof(buf));
          fillRow(row, "Today", buf, sel);
        } else if (idx == 1) {
          snprintf(buf, sizeof(buf), "%d", Storage::todayFocusCount());
          fillRow(row, "Focus blocks", buf, sel);
        } else if (idx == 2) {
          snprintf(buf, sizeof(buf), "%d", Storage::todaySetsCount());
          fillRow(row, "Sets today", buf, sel);
        } else if (idx == 3) {
          if (last.actualFocusSec > 0) {
            snprintf(buf, sizeof(buf), "%dm %s",
                     sessionLogMinutes(last.actualFocusSec),
                     sessionStatusName(last.status));
            fillRow(row, "Last", buf, sel);
          } else {
            fillRow(row, "Last", "none", sel);
          }
        } else if (idx == 4) {
          uint32_t tot = Storage::totalFocusSec();
          int th = (int)(tot / 3600);
          int tm = (int)((tot % 3600) / 60);
          if (th > 0) snprintf(buf, sizeof(buf), "%dh %dm", th, tm);
          else        snprintf(buf, sizeof(buf), "%dm", tm);
          fillRow(row, "Total", buf, sel);
        } else if (idx == 5) {
          fillRow(row, "History", nullptr, sel, MI_HISTORY, true);
        } else if (idx == 6) {
          snprintf(buf, sizeof(buf), "%dm", (int)s_cfg->dailyGoalMin);
          fillRow(row, "Daily goal", buf, sel, MI_GOAL);
        } else {
          fillRow(row, "Reset day", nullptr, sel);
        }
        break;
      }

      case SCR_STATS_HISTORY: {
        int n = Storage::sessionLogCount();
        if (n <= 0) {
          fillRow(row, "No sessions yet", nullptr, sel);
        } else {
          SessionLogEntry e;
          if (Storage::sessionLogAt(idx, e)) {
            formatSessionLogRow(buf, sizeof(buf), e);
            fillRow(row, buf, nullptr, sel);
          }
        }
        break;
      }

      case SCR_DEVICE:
        if (idx == 0) {
          if (s_paired) {
            String owner = Storage::ownerDisplayName();
            fillRow(row, "Sign out", owner.length() ? owner.c_str() : "Account", sel, MI_PAIR);
          } else {
            fillRow(row, "Pair account", nullptr, sel, MI_PAIR);
          }
        } else if (idx == 1) fillRow(row, "Info", nullptr, sel, MI_DEVICE, true);
        else if (idx == 2) fillRow(row, "Wi-Fi Setup", nullptr, sel, MI_WIFI);
        else if (idx == 3) fillRow(row, "Sync now", nullptr, sel, MI_WIFI);
        else if (idx == 4) fillRow(row, "Diagnostics", nullptr, sel, MI_DIAG);
        else fillRow(row, "Factory reset", nullptr, sel);
        break;

      case SCR_DEVICE_INFO: {
        char d[28];
        switch (idx) {
          case 0: { String s = Cloud::ssid();    snprintf(d, sizeof(d), "wifi %s", s.length() ? s.c_str() : "--"); break; }
          case 1: { String s = Cloud::ipString();snprintf(d, sizeof(d), "ip %s",   s.length() ? s.c_str() : "--"); break; }
          case 2: if (Cloud::online()) snprintf(d, sizeof(d), "signal %ddBm", Cloud::wifiRssi());
                  else                 snprintf(d, sizeof(d), "signal --"); break;
          case 3: snprintf(d, sizeof(d), "link %s", Cloud::online() ? "up" : "down"); break;
          case 4: snprintf(d, sizeof(d), "internet %s", Cloud::haveClock() ? "yes" : "no"); break;
          case 5: snprintf(d, sizeof(d), "server %s", Cloud::serverReachable() ? "ok" : "down"); break;
          case 6: snprintf(d, sizeof(d), "http %d", Cloud::lastHttpStatus()); break;
          case 7: snprintf(d, sizeof(d), "uploads %d", Cloud::pendingCount()); break;
          case 8: snprintf(d, sizeof(d), "fw %s", FW_VERSION); break;
          case 9: snprintf(d, sizeof(d), "id %s", s_devId); break;
          case 10: { uint32_t up = millis() / 1000;
                     snprintf(d, sizeof(d), "up %luh%lum", (unsigned long)(up / 3600),
                              (unsigned long)((up % 3600) / 60)); break; }
          default: snprintf(d, sizeof(d), "heap %uk", (unsigned)(ESP.getFreeHeap() / 1024)); break;
        }
        fillRow(row, d, nullptr, sel);
        break;
      }

      case SCR_FACTORY_CONFIRM:
        if (idx == 0) fillRow(row, "Cancel", nullptr, sel);
        else fillRow(row, "Confirm reset", nullptr, sel);
        break;

      default: break;
    }
  }

  if (s_screen == SCR_DEVICE && s_paired) {
    String email = Storage::ownerEmail();
    if (email.length() > 21) email = email.substring(0, 21);
    if (email.length())
      strncpy(v.accountEmail, email.c_str(), sizeof(v.accountEmail) - 1);
  }

  if (s_screen == SCR_ABOUT)   // info-only screen (no rows)
    snprintf(v.infoLine, sizeof(v.infoLine), "Firmware v%s", FW_VERSION);

  if (s_screen == SCR_FACTORY_CONFIRM)
    strncpy(v.infoLine, "Erases all settings", sizeof(v.infoLine) - 1);

  s_dirty = false;
  return v;
}

bool dirty() { return s_dirty; }
void clearDirty() { s_dirty = false; }

void pausedReset(PauseReason reason) {
  s_pauseCursor = 0;
  s_pauseReason = reason;
  Inputs::setInputMode(INPUT_MENU);
}

MenuAction pausedTick(int rotDir, int sideBtn) {
  if (rotDir != 0) {
    s_pauseCursor += rotDir;
    if (s_pauseCursor < 0) s_pauseCursor = 2;
    if (s_pauseCursor > 2) s_pauseCursor = 0;
    Haptics::click();
  }
  if (sideBtn != 1) return MENU_NONE;
  Haptics::tap();
  if (s_pauseCursor == 0) return MENU_RESUME_SESSION;
  if (s_pauseCursor == 1) return MENU_SKIP_INTERVAL;
  return MENU_END_SESSION;
}

const MenuView& pausedView() {
  static MenuView v;
  memset(&v, 0, sizeof(v));
  strncpy(v.title, "PAUSED", sizeof(v.title) - 1);
  strncpy(v.infoLine, pauseReasonLine(s_pauseReason), sizeof(v.infoLine) - 1);
  fillRow(v.rows[0], "Resume", nullptr, s_pauseCursor == 0);
  fillRow(v.rows[1], "Skip", nullptr, s_pauseCursor == 1);
  fillRow(v.rows[2], "End session", nullptr, s_pauseCursor == 2);
  v.rowCount = 3;
  return v;
}

// In-session Settings list (level 1 of the running overlay). Reuses the global toggle handlers, so
// changes persist and stay in sync with the main Settings menu; the session clock keeps running.
static const int RUN_SET_ROWS = 8;

static void runSettingsFillRow(MenuRow& r, int idx, bool sel) {
  char b[8];
  switch (idx) {
    case 0: fillRow(r, "Show timer",  s_cfg->showTimer      ? "ON" : "OFF", sel); break;
    case 1: fillRow(r, "Noise alert", s_cfg->alertNoise     ? "ON" : "OFF", sel); break;
    case 2: fillRow(r, "Temp alert",  s_cfg->alertTemp      ? "ON" : "OFF", sel); break;
    case 3: fillRow(r, "Auto-pause",  s_cfg->autoPause      ? "ON" : "OFF", sel); break;
    case 4: fillRow(r, "Haptics",     s_cfg->hapticsEnabled ? "ON" : "OFF", sel); break;
    case 5: fillRow(r, "Sound",       s_cfg->soundEnabled   ? "ON" : "OFF", sel); break;
    case 6: fillRow(r, "Auto-bright", s_cfg->autoBrightness ? "ON" : "OFF", sel); break;
    default: snprintf(b, sizeof(b), "%u%%", s_cfg->brightnessPct);
             fillRow(r, "Brightness", b, sel); break;     // idx 7
  }
}

static void runSettingsSelect(int idx) {
  switch (idx) {
    case 0: toggleShowTimer();      break;
    case 1: toggleAlertNoise();     break;
    case 2: toggleAlertTemp();      break;
    case 3: toggleAutoPause();      break;
    case 4: toggleHaptics();        break;
    case 5: toggleSound();          break;
    case 6: toggleAutoBrightness(); break;
    default: cycleBrightness();     break;                // idx 7
  }
}

void runningOpen() {
  s_runningMenu = true;
  s_runCursor = 0;
  s_runLevel = 0; s_setCursor = 0; s_setScroll = 0;
  Inputs::setInputMode(INPUT_MENU);
  markDirty();
}

void runningDismiss() {
  s_runningMenu = false;
  s_runLevel = 0;
  markDirty();
}

bool runningActive() { return s_runningMenu; }

MenuAction runningTick(int rotDir, int sideBtn) {
  // Level 1: the in-session Settings list (toggles apply in place; clock keeps running).
  if (s_runLevel == 1) {
    if (sideBtn == 2) { s_runLevel = 0; s_setCursor = 0; s_setScroll = 0; markDirty(); return MENU_NONE; }
    if (rotDir != 0) {
      s_setCursor += rotDir;
      if (s_setCursor < 0) s_setCursor = RUN_SET_ROWS - 1;
      if (s_setCursor >= RUN_SET_ROWS) s_setCursor = 0;
      if (s_setCursor < s_setScroll) s_setScroll = s_setCursor;
      if (s_setCursor >= s_setScroll + MENU_VISIBLE_ROWS) s_setScroll = s_setCursor - MENU_VISIBLE_ROWS + 1;
      Haptics::click();
      markDirty();
    }
    if (sideBtn == 1) runSettingsSelect(s_setCursor);   // toggle, stay in the list
    return MENU_NONE;
  }

  // Level 0: the top overlay — Pause / Skip / End / Settings (Settings last).
  static const int RUN_ROWS = 4;
  if (sideBtn == 2) { runningDismiss(); return MENU_NONE; }
  if (rotDir != 0) {
    s_runCursor = (s_runCursor + rotDir + RUN_ROWS) % RUN_ROWS;
    Haptics::click();
    markDirty();
  }
  if (sideBtn != 1) return MENU_NONE;
  switch (s_runCursor) {
    case 1: Haptics::tap();  return MENU_SKIP_INTERVAL;     // skip to next interval
    case 2: Haptics::tap();  return MENU_END_SESSION;       // end the session
    case 3: s_runLevel = 1; s_setCursor = 0; s_setScroll = 0; Haptics::tap(); markDirty(); return MENU_NONE; // open Settings
    default: Haptics::tap(); return MENU_PAUSE_SESSION;     // 0 = Pause
  }
}

const MenuView& runningView() {
  static MenuView v;
  memset(&v, 0, sizeof(v));
  if (s_runLevel == 1) {
    strncpy(v.title, "SETTINGS", sizeof(v.title) - 1);
    v.rowCount = 0;
    for (int i = 0; i < MENU_VISIBLE_ROWS; i++) {
      int idx = s_setScroll + i;
      if (idx >= RUN_SET_ROWS) break;
      runSettingsFillRow(v.rows[v.rowCount++], idx, idx == s_setCursor);
    }
    return v;
  }
  strncpy(v.title, "SESSION", sizeof(v.title) - 1);
  fillRow(v.rows[0], "Pause", nullptr, s_runCursor == 0);
  fillRow(v.rows[1], "Skip", nullptr, s_runCursor == 1);
  fillRow(v.rows[2], "End", nullptr, s_runCursor == 2);
  fillRow(v.rows[3], "Settings", nullptr, s_runCursor == 3, MI_NONE, true);
  v.rowCount = 4;
  return v;
}

void resumePromptReset(int remainMin, Mode m, int focusDone, int cycleTotal, bool setActive) {
  s_resumeCursor = 0;
  s_resumeRemainMin = remainMin;
  s_resumeMode = m;
  if (setActive && cycleTotal > 1) {
    char info[24];
    if (m == MODE_WORK)
      snprintf(info, sizeof(info), "WORK %d/%d %dm left", focusDone + 1, cycleTotal, remainMin);
    else
      snprintf(info, sizeof(info), "BREAK %dm left", remainMin);
    // stash in static for view - use separate statics
    s_resumeSetActive = true;
    s_resumeFocusDone = focusDone;
    s_resumeCycleTotal = cycleTotal;
  } else {
    s_resumeSetActive = false;
  }
  Inputs::setInputMode(INPUT_MENU);
  markDirty();
}

MenuAction resumePromptTick(int rotDir, int sideBtn) {
  if (rotDir != 0) {
    s_resumeCursor += rotDir;
    if (s_resumeCursor < 0) s_resumeCursor = 1;
    if (s_resumeCursor > 1) s_resumeCursor = 0;
    Haptics::click();
  }
  if (sideBtn != 1) return MENU_NONE;
  Haptics::tap();
  return (s_resumeCursor == 0) ? MENU_RESUME_CHECKPOINT : MENU_DISCARD_CHECKPOINT;
}

const MenuView& resumePromptView() {
  static MenuView v;
  memset(&v, 0, sizeof(v));
  strncpy(v.title, "RESUME", sizeof(v.title) - 1);
  char info[24];
  if (s_resumeSetActive && s_resumeCycleTotal > 1) {
    if (s_resumeMode == MODE_WORK)
      snprintf(info, sizeof(info), "WORK %d/%d %dm left",
               s_resumeFocusDone + 1, s_resumeCycleTotal, s_resumeRemainMin);
    else
      snprintf(info, sizeof(info), "BREAK %dm left", s_resumeRemainMin);
  } else {
    snprintf(info, sizeof(info), "%dm %s left", s_resumeRemainMin,
             s_resumeMode == MODE_WORK ? "focus" : "break");
  }
  strncpy(v.infoLine, info, sizeof(v.infoLine) - 1);
  fillRow(v.rows[0], "Resume", nullptr, s_resumeCursor == 0);
  fillRow(v.rows[1], "End session", nullptr, s_resumeCursor == 1);
  v.rowCount = 2;
  return v;
}

void cycleOfferReset(Mode nextMode, int nextMin, int focusDone, int cycleTotal) {
  s_cycleCursor = 0;
  s_cycleNextMode = nextMode;
  s_cycleNextMin = nextMin;
  s_cycleFocusDone = focusDone;
  s_cycleTotal = cycleTotal;
  Inputs::setInputMode(INPUT_MENU);
  markDirty();
}

MenuAction cycleOfferTick(int rotDir, int sideBtn) {
  if (sideBtn == 2) return MENU_SKIP_CYCLE;
  if (rotDir != 0) {
    s_cycleCursor += rotDir;
    if (s_cycleCursor < 0) s_cycleCursor = 1;
    if (s_cycleCursor > 1) s_cycleCursor = 0;
    Haptics::click();
    markDirty();
  }
  if (sideBtn != 1) return MENU_NONE;
  Haptics::tap();
  return (s_cycleCursor == 0) ? MENU_START_CYCLE : MENU_SKIP_CYCLE;
}

const MenuView& cycleOfferView() {
  static MenuView v;
  memset(&v, 0, sizeof(v));
  strncpy(v.title, "NEXT", sizeof(v.title) - 1);
  char info[24];
  if (s_cycleNextMode == MODE_BREAK)
    snprintf(info, sizeof(info), "Focus %d/%d done", s_cycleFocusDone, s_cycleTotal);
  else
    snprintf(info, sizeof(info), "Next focus %d/%d", s_cycleFocusDone + 1, s_cycleTotal);
  strncpy(v.infoLine, info, sizeof(v.infoLine) - 1);

  char label[20];
  char val[12];
  snprintf(label, sizeof(label), "Start %s",
           s_cycleNextMode == MODE_BREAK ? "break" : "focus");
  snprintf(val, sizeof(val), "%dm", s_cycleNextMin);
  fillRow(v.rows[0], label, val, s_cycleCursor == 0);
  fillRow(v.rows[1], "Done for now", nullptr, s_cycleCursor == 1);
  v.rowCount = 2;
  return v;
}

} // namespace Menu
