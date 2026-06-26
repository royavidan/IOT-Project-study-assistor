#pragma once
// ============================================================================
// types.h — shared enums, structs, and tiny inline helpers used across modules.
// Mirrors the cloud contracts in mindbox-companion-forge-main/src/lib/focus-load.ts.
// (S3 port — only the config.h include path differs from the sibling.)
// ============================================================================
#include <Arduino.h>
#include <time.h>
#include "config.h"

// Device state machine (see StateMachine + the Tactile Interaction Model doc).
enum SysState {
  ST_BOOTING, ST_IDLE, ST_RUNNING,
  ST_PAUSED, ST_COMPLETE, ST_LOGGING, ST_ERROR, ST_PAIRING, ST_DIAG,
  ST_RESUME, ST_CYCLE_OFFER, ST_WIFI_SETUP
};

enum Mode { MODE_WORK, MODE_BREAK };

enum PauseReason { PAUSE_MANUAL, PAUSE_AWAY, PAUSE_COACHING };

// Live environment interference shown on the running screen (replaces focus-load %).
enum Interference {
  INTERF_NONE = 0, INTERF_TEMP_HIGH, INTERF_TEMP_LOW, INTERF_NOISE_HIGH,
  INTERF_LIGHT_HIGH, INTERF_LIGHT_LOW, INTERF_AWAY
};

inline const char* interferenceLabel(uint8_t i) {
  switch (i) {
    case INTERF_TEMP_HIGH:  return "temp high";
    case INTERF_TEMP_LOW:   return "temp low";
    case INTERF_NOISE_HIGH: return "noise high";
    case INTERF_LIGHT_HIGH: return "light high";
    case INTERF_LIGHT_LOW:  return "light low";
    case INTERF_AWAY:       return "away";
    default:                return "";
  }
}

// Settings the companion site can push down to the box (config downlink).
struct DeviceConfig {
  bool     showTimer;
  bool     hapticsEnabled;
  bool     adaptiveCoaching;
  bool     coachingNudgeScreen;
  bool     coachingNudgeHaptic;
  bool     coachingAutoPause;
  bool     nudgesEnabled;
  bool     autoPause;          // ToF: pause when away from desk
  uint8_t  presencePauseIdx; // 0=30s 1=1m 2=2m
  uint8_t  presenceEndIdx;   // 0=5m 1=10m 2=never
  uint16_t quietStartMin;      // minutes from midnight, 0xFFFF = quiet hours off
  uint16_t quietEndMin;
  uint16_t dailyGoalMin;
  bool     longBreakEnabled;   // pomodoro long break after N focus blocks
  uint8_t  longBreakEvery;     // N focus blocks between long breaks
  uint16_t longBreakMin;       // long break duration (minutes)
  bool     autoStartCycle;     // start next interval automatically (skip NEXT prompt)
  bool     strictMode;         // block End/Skip during a focus block
  uint8_t  brightnessPct;      // screen backlight 0..100 (manual; used when autoBrightness is off)
  bool     autoBrightness;     // drive the backlight from the KY-018 light sensor (overrides brightnessPct)
  uint8_t  hapticLevel;        // 0=low 1=med 2=high motor strength
  // Environment interference alerts (each fires only if its HAS_* sensor is wired AND enabled).
  bool     alertTemp;          // warn on temperature out of comfort band
  bool     alertNoise;         // warn on high noise
  bool     alertLight;         // warn on light out of comfort band
  bool     alertPresence;      // warn when away from desk
  bool     alertNudge;         // haptic + flash when an alert persists
  int8_t   tempMinC;           // comfort band (°C)
  int8_t   tempMaxC;
  uint8_t  noiseMaxDb;         // noise "too high" above this many dB SPL (local-only; not server-synced)
  uint16_t lightMinLux;        // light comfort band (lux)
  uint16_t lightMaxLux;
  bool     soundEnabled;       // speaker event chimes (ES8311 + FM8002E amp)
  uint8_t  soundLevel;         // 0=low 1=med 2=high chime volume (software gain)
};

// Compact offline session log entry (NVS ring buffer, v2 adds utcDay).
struct SessionLogEntry {
  uint32_t actualFocusSec;
  uint16_t targetSec;
  uint8_t  mode;       // Mode
  uint8_t  breaks;
  uint8_t  presInt;
  uint8_t  status;     // 0=completed 1=interrupted 2=aborted
  uint32_t utcDay;     // calendar/manual day id; 0 = unknown bucket
};

#define SESSION_LOG_MAX 16

// One in-session telemetry sample (Story 8/10), kept in RAM for live upload.
struct Sample {
  uint16_t t;        // seconds since session start
  uint8_t  fle;      // Focus Load Estimate 0..100 at time t
  float    noise;    // normalized 0..1
  float    tempC;    // NAN if no temp sensor
  float    lightLux;
};

// In-progress session snapshot for NVS resume after power loss.
struct SessionCheckpoint {
  SysState sysState;     // ST_RUNNING or ST_PAUSED
  Mode     mode;
  int32_t  remainingMs;
  uint32_t actualMs;
  uint32_t targetSec;
  uint8_t  breaks;
  uint8_t  presInt;
  time_t   startEpoch;
  uint8_t  setCycleTotal;
  uint8_t  setFocusDone;
  uint8_t  setActive;
  // Env sample tail (last CHECKPOINT_TAIL_MAX samples + aggregates for finish()).
  uint8_t  sampleCount;  // total samples taken so far (informational; RAM holds tail only)
  uint8_t  tailCount;    // samples in tail[]
  Sample   tail[CHECKPOINT_TAIL_MAX];
  float    noiseSum;
  float    noisePeak;
  uint16_t noiseN;
  uint32_t lastSampleMs; // millis() at save; reset on cold boot resume
};

// Completed-session summary (mirrors SessionPayload in focus-load.ts).
struct SessionRecord {
  char        sessionId[37];
  uint32_t    clientSeq;
  time_t      startedAt;     // 0 if no synced clock yet
  time_t      endedAt;
  int         targetSec;
  int         actualFocusSec;
  Mode        mode;
  const char* status;        // "completed" | "interrupted" | "aborted"
  int         breaks;
  int         presenceInterruptions;
  uint32_t    awayMs;        // total away time during the session (so server can show true focus = elapsed - away)
  float       noiseAvg, noisePeak, tempC, lightLux;
  int         focusLoadAvg;
};

// Snapshot of which sensors are wired/healthy (telemetry + diagnostics).
struct SensorHealth {
  bool micOk, tofPresent, tofOk, lightPresent, tempPresent, batteryPresent;
};

// Everything the Display needs to draw a frame — decouples UI from the FSM.
struct UiModel {
  SysState state;
  Mode     mode;
  int      durationMin;
  bool     showTimer;
  int      remainingSec;
  int      targetSec;
  int         actualFocusMin;
  int         sessionBreaks;
  int         sessionPresInt;
  bool        setActive;
  bool        setComplete;
  int         setFocusDone;
  int         setCycleTotal;
  bool        coachingNudge;
  int         coachingFle;       // live focus-load estimate (0..100), telemetry only
  int         sessionFocusLoad;  // COMPLETE summary: avg focus load, or -1
  int         sessionNoisePct;   // COMPLETE summary: avg noise %, or -1 if n/a
  float       sessionTempC;      // COMPLETE summary: avg temp °C (NaN if no temp samples)
  bool        sessionTempHot;    // COMPLETE summary: avg temp out of comfort band -> light the icon
  bool        envHot;            // live (running): temp out of comfort band right now
  bool        envLoud;           // live (running): noise above comfort right now
  bool        envAway;           // live (running): ToF says away right now
  uint8_t     interference;      // live Interference shown on the running screen
  uint8_t     sessionInterf;     // worst Interference this session (DONE summary)
  PauseReason pauseReason;
  bool        wifi;
  bool        present;
  bool        paired;        // linked to a user account (via config downlink)
  const char* deviceId;      // short id (no "mindbox-" prefix), for home/pairing
  const char* pairCode;      // 6-digit code while ST_PAIRING, else ""
  char        clockStr[8];   // "HH:MM" local time when online, else "" (running-screen corner)
};

// Minimal telemetry heartbeat payload (Story 15/17).
struct TelemetryModel {
  const char* state;
  int         batteryPct;
  int         wifiRssi;
};

// Live device snapshot the loop hands to the core-0 net task (live mirror).
struct TelemetrySnap {
  uint8_t state;        // SysState
  uint8_t mode;         // Mode
  int     remainingSec;
  int     fle;
  uint8_t setIndex;     // focus blocks done in the current set
  uint8_t setTotal;
  bool    setActive;
  uint8_t pauseReason;  // PauseReason
  int     batteryPct;
  char    health[96];   // Sensors::healthJson()
};

// App-managed settings pulled from the downlink, overlaid onto DeviceConfig.
struct CloudSettings {
  bool     paired;
  bool     showTimer, hapticsEnabled, adaptiveCoaching, nudgesEnabled;
  uint16_t quietStartMin, quietEndMin, dailyGoalMin;
  int32_t  todayFocusSec;   // server-truth focus today (account-wide, local day)
  char     ownerDisplayName[20];
  char     ownerEmail[32];
};

// Remote command from the app (Part 3), delivered loop<-task via a queue.
enum CmdType { CMD_NONE, CMD_START, CMD_PAUSE, CMD_RESUME, CMD_END };
struct RemoteCmd {
  uint8_t  type;        // CmdType
  uint8_t  mode;        // Mode (for CMD_START)
  uint16_t durationMin; // for CMD_START
};

// Per-row icon id for the colored-tile menu (glyphs + tile colors live in
// Icons.h / Theme.h, keyed off these ids). MI_NONE = no badge (plain row).
enum MenuIcon {
  MI_NONE = 0, MI_START, MI_MODE, MI_SETTINGS, MI_PRESENCE, MI_DISPLAY,
  MI_COACHING, MI_STATS, MI_HISTORY, MI_GOAL, MI_DEVICE, MI_PAIR, MI_WIFI,
  MI_DIAG, MI_ABOUT, MI_BACK,
  MI_TEMP, MI_NOISE   // env-status glyphs (lit when hot / loud); MI_PRESENCE reused for away
};

// Pointer-menu row for Display::renderMenu (cursor + scroll lists).
#define MENU_VISIBLE_ROWS 4
struct MenuRow {
  char    label[20];
  char    value[12];
  bool    hasValue;
  bool    selected;
  uint8_t icon;      // MenuIcon — colored tile badge (MI_NONE = none)
  bool    chevron;   // draw a "›" affordance for rows that drill into a sub-screen
};

struct MenuView {
  char     title[16];
  char     statusWord[12];
  char     clockStr[8];     // "HH:MM" local time when online, else "" (drawn top-right in the header)
  bool     showBrand;       // root screen: "MindBox" header instead of title
  MenuRow  rows[MENU_VISIBLE_ROWS];
  uint8_t  rowCount;
  bool     durationEditor;  // full-screen spinner instead of list
  int      durationMin;
  float    durationFrac;
  char     infoLine[24];    // optional subtitle (READY screen summary)
  char     accountEmail[32]; // DEVICE screen: shown below Sign out when paired
};

// Actions Menu::tick() returns for StateMachine to handle.
enum MenuAction {
  MENU_NONE,
  MENU_START_SESSION,
  MENU_ENTER_PAIRING,
  MENU_SIGN_OUT,
  MENU_ENTER_DIAGNOSTICS,
  MENU_ENTER_WIFI_SETUP,
  MENU_RESUME_SESSION,
  MENU_END_SESSION,
  MENU_SKIP_INTERVAL,        // skip the current work/break interval, credit actual elapsed focus
  MENU_PAUSE_SESSION,
  MENU_RESUME_CHECKPOINT,
  MENU_DISCARD_CHECKPOINT,
  MENU_START_CYCLE,
  MENU_SKIP_CYCLE,
  MENU_ADD_TIME,
  MENU_SYNC_NOW,
  MENU_FACTORY_RESET,
};

inline const char* modeName(Mode m) { return m == MODE_WORK ? "WORK" : "BREAK"; }

inline const char* pauseReasonLine(PauseReason r) {
  switch (r) {
    case PAUSE_AWAY:     return "Away from desk";
    case PAUSE_COACHING: return "High focus load";
    default:             return "Manual pause";
  }
}

inline DeviceConfig defaultConfig() {
  return { /*showTimer*/ true, /*haptics*/ true, /*adaptive*/ false,
           /*nudgeScr*/ true, /*nudgeHap*/ true, /*coachPause*/ false,
           /*nudges*/ true, /*autoPause*/ false, /*pauseIdx*/ 0, /*endIdx*/ 0,
           /*quietStart*/ 0xFFFF, /*quietEnd*/ 0xFFFF,
           /*dailyGoal*/ 180,
           /*longBreakEnabled*/ true, /*longBreakEvery*/ 4, /*longBreakMin*/ 15,
           /*autoStartCycle*/ false, /*strictMode*/ false,
           /*brightnessPct*/ 100, /*autoBrightness*/ false, /*hapticLevel*/ 2,
           /*alertTemp*/ true, /*alertNoise*/ true, /*alertLight*/ true,
           /*alertPresence*/ true, /*alertNudge*/ true,
           /*tempMinC*/ 18, /*tempMaxC*/ 26, /*noiseMaxDb*/ 60,
           /*lightMinLux*/ 50, /*lightMaxLux*/ 1000,
           /*soundEnabled*/ false, /*soundLevel*/ 1 };
}

inline unsigned long presencePauseMs(const DeviceConfig& c) {
  static const unsigned long ms[] = { 30000UL, 60000UL, 120000UL };
  return ms[c.presencePauseIdx > 2 ? 0 : c.presencePauseIdx];
}

inline unsigned long presenceEndMs(const DeviceConfig& c) {
  if (c.presenceEndIdx >= 2) return 0;
  static const unsigned long ms[] = { 300000UL, 600000UL };
  return ms[c.presenceEndIdx];
}

inline uint8_t sessionStatusIdx(const char* status) {
  if (status && status[0] == 'c') return 0;
  if (status && status[0] == 'a') return 2;
  return 1;
}

inline const char* sessionStatusName(uint8_t idx) {
  switch (idx) {
    case 0:  return "done";
    case 2:  return "abort";
    default: return "stop";
  }
}

inline int sessionLogMinutes(uint32_t sec) {
  return (int)((sec + 59) / 60);
}

inline void formatSessionLogRow(char* buf, size_t n, const SessionLogEntry& e) {
  const char* md = (e.mode == MODE_WORK) ? "WORK" : "BREAK";
  snprintf(buf, n, "%dm %s %s", sessionLogMinutes(e.actualFocusSec), md,
           sessionStatusName(e.status));
}
