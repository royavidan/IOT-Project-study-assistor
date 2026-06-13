#include "Menu.h"
#include "config.h"
#include "Inputs.h"
#include "Haptics.h"
#include "Storage.h"

enum Screen {
  SCR_ROOT,
  SCR_MODE,
  SCR_WORK_DUR,
  SCR_BREAK_DUR,
  SCR_SETTINGS,
  SCR_DISPLAY,
  SCR_PRESENCE,
  SCR_COACHING,
  SCR_STATS,
  SCR_STATS_HISTORY,
  SCR_GOAL,
  SCR_DEVICE,
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

static const char* connWord() {
  if (s_paired) return s_wifi ? "synced" : "paired";
  return s_wifi ? "online" : "offline";
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
    case SCR_MODE:     return 5;
    case SCR_SETTINGS: return 4;
    case SCR_DISPLAY:  return 4;
    case SCR_PRESENCE: return 3;
    case SCR_COACHING: return 4;
    case SCR_STATS:         return 8;
    case SCR_STATS_HISTORY: {
      int n = Storage::sessionLogCount();
      return n > 0 ? n : 1;
    }
    case SCR_DEVICE:   return 4;
    case SCR_ABOUT:    return 1;
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
      }
      Haptics::tap();
      markDirty();
      break;

    case SCR_DISPLAY:
      if (s_cursor == 0) toggleShowTimer();
      else if (s_cursor == 1) toggleHaptics();
      else if (s_cursor == 2) {
        Serial.println("[menu] Test motor selected");
        Haptics::testPulse();
      } else pop();
      if (s_cursor == 3) Haptics::click();
      markDirty();
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
      if (s_cursor == 1) return MENU_ENTER_WIFI_SETUP;
      if (s_cursor == 2) return MENU_ENTER_DIAGNOSTICS;
      pop();
      Haptics::click();
      break;

    case SCR_ABOUT:
      pop();
      Haptics::click();
      break;

    default: break;
  }
  return MENU_NONE;
}

static void fillRow(MenuRow& r, const char* label, const char* val, bool sel) {
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

  v.durationEditor = false;
  v.showBrand = (s_screen == SCR_ROOT);
  if (v.showBrand) {
    strncpy(v.title, "MindBox", sizeof(v.title) - 1);
  } else {
    const char* titles[] = {
      "MindBox", "MODE", "WORK MIN", "BREAK MIN", "SETTINGS",
      "DISPLAY", "PRESENCE", "COACHING", "STATS", "HISTORY", "GOAL", "DEVICE", "ABOUT"
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
            fillRow(row, "Start", buf, sel);
            break;
          case 1:
            formatModeVal(buf, sizeof(buf));
            fillRow(row, "Mode", buf, sel);
            break;
          case 2: fillRow(row, "Settings", nullptr, sel); break;
          case 3: fillRow(row, "Device", connWord(), sel); break;
          case 4: fillRow(row, "About", FW_VERSION, sel); break;
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
        }
        break;

      case SCR_SETTINGS:
        switch (idx) {
          case 0: fillRow(row, "Presence", nullptr, sel); break;
          case 1: fillRow(row, "Display", nullptr, sel); break;
          case 2: fillRow(row, "Coaching", nullptr, sel); break;
          case 3: fillRow(row, "Stats", nullptr, sel); break;
        }
        break;

      case SCR_DISPLAY:
        if (idx == 0) fillRow(row, "Show timer", s_cfg->showTimer ? "ON" : "OFF", sel);
        else if (idx == 1) fillRow(row, "Haptics", s_cfg->hapticsEnabled ? "ON" : "OFF", sel);
        else if (idx == 2) fillRow(row, "Test motor", Haptics::isHolding() ? "MAX..." : "press", sel);
        else fillRow(row, "Back", nullptr, sel);
        break;

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
          fillRow(row, "History", ">", sel);
        } else if (idx == 6) {
          snprintf(buf, sizeof(buf), "%dm", (int)s_cfg->dailyGoalMin);
          fillRow(row, "Daily goal", buf, sel);
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
            fillRow(row, "Sign out", owner.length() ? owner.c_str() : "Account", sel);
          } else {
            fillRow(row, "Pair account", nullptr, sel);
          }
        } else if (idx == 1) fillRow(row, "Wi-Fi Setup", nullptr, sel);
        else if (idx == 2) fillRow(row, "Diagnostics", nullptr, sel);
        else fillRow(row, "Back", nullptr, sel);
        break;

      case SCR_ABOUT:
        fillRow(row, "Back", nullptr, sel);
        snprintf(v.infoLine, sizeof(v.infoLine), "Firmware v%s", FW_VERSION);
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
    if (s_pauseCursor < 0) s_pauseCursor = 1;
    if (s_pauseCursor > 1) s_pauseCursor = 0;
    Haptics::click();
  }
  if (sideBtn != 1) return MENU_NONE;
  Haptics::tap();
  return (s_pauseCursor == 0) ? MENU_RESUME_SESSION : MENU_END_SESSION;
}

const MenuView& pausedView() {
  static MenuView v;
  memset(&v, 0, sizeof(v));
  strncpy(v.title, "PAUSED", sizeof(v.title) - 1);
  strncpy(v.infoLine, pauseReasonLine(s_pauseReason), sizeof(v.infoLine) - 1);
  fillRow(v.rows[0], "Resume", nullptr, s_pauseCursor == 0);
  fillRow(v.rows[1], "End session", nullptr, s_pauseCursor == 1);
  v.rowCount = 2;
  return v;
}

void runningOpen() {
  s_runningMenu = true;
  s_runCursor = 0;
  Inputs::setInputMode(INPUT_MENU);
  markDirty();
}

void runningDismiss() {
  s_runningMenu = false;
  markDirty();
}

bool runningActive() { return s_runningMenu; }

MenuAction runningTick(int rotDir, int sideBtn) {
  // Rows: 0 Pause, 1 Show timer (toggle), 2 Haptics (toggle), 3 End.
  static const int RUN_ROWS = 4;
  if (sideBtn == 2) {
    runningDismiss();
    return MENU_NONE;
  }
  if (rotDir != 0) {
    s_runCursor = (s_runCursor + rotDir + RUN_ROWS) % RUN_ROWS;
    Haptics::click();
    markDirty();
  }
  if (sideBtn != 1) return MENU_NONE;
  switch (s_runCursor) {
    case 1: toggleShowTimer(); return MENU_NONE;   // live eyes-off toggle, stay in overlay
    case 2: toggleHaptics();   return MENU_NONE;   // silence/restore buzzes, stay in overlay
    case 3: Haptics::tap();    return MENU_END_SESSION;
    default: Haptics::tap();   return MENU_PAUSE_SESSION;
  }
}

const MenuView& runningView() {
  static MenuView v;
  memset(&v, 0, sizeof(v));
  strncpy(v.title, "SESSION", sizeof(v.title) - 1);
  fillRow(v.rows[0], "Pause", nullptr, s_runCursor == 0);
  fillRow(v.rows[1], "Show timer", s_cfg->showTimer ? "ON" : "OFF", s_runCursor == 1);
  fillRow(v.rows[2], "Haptics", s_cfg->hapticsEnabled ? "ON" : "OFF", s_runCursor == 2);
  fillRow(v.rows[3], "End", nullptr, s_runCursor == 3);
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
