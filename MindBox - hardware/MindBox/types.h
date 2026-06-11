#pragma once
// ============================================================================
// types.h — shared enums, structs, and tiny inline helpers used across modules.
// Mirrors the cloud contracts in mindbox-companion-forge-main/src/lib/focus-load.ts.
// ============================================================================
#include <Arduino.h>
#include <time.h>
#include "config.h"

// Device state machine (see StateMachine + the Tactile Interaction Model doc).
enum SysState {
  ST_BOOTING, ST_IDLE, ST_RUNNING,
  ST_PAUSED, ST_COMPLETE, ST_LOGGING, ST_ERROR, ST_PAIRING, ST_DIAG,
  ST_RESUME, ST_CYCLE_OFFER
};

enum Mode { MODE_WORK, MODE_BREAK };

enum PauseReason { PAUSE_MANUAL, PAUSE_AWAY, PAUSE_COACHING };

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
  uint16_t quietStartMin;
  uint16_t quietEndMin;
  uint16_t dailyGoalMin;
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
  int         coachingFle;
  PauseReason pauseReason;
  bool        wifi;
  bool        present;
  bool        paired;        // linked to a user account (via config downlink)
  const char* deviceId;      // short id (no "mindbox-" prefix), for home/pairing
  const char* pairCode;      // 6-digit code while ST_PAIRING, else ""
};

// Minimal telemetry heartbeat payload (Story 15/17).
struct TelemetryModel {
  const char* state;
  int         batteryPct;
  int         wifiRssi;
};

// Pointer-menu row for Display::renderMenu (cursor + scroll lists).
#define MENU_VISIBLE_ROWS 4
struct MenuRow {
  char label[20];
  char value[12];
  bool hasValue;
  bool selected;
};

struct MenuView {
  char     title[16];
  char     statusWord[12];
  bool     showBrand;       // root screen: "MindBox" header instead of title
  MenuRow  rows[MENU_VISIBLE_ROWS];
  uint8_t  rowCount;
  bool     durationEditor;  // full-screen spinner instead of list
  int      durationMin;
  float    durationFrac;
  char     infoLine[24];    // optional subtitle (READY screen summary)
};

// Actions Menu::tick() returns for StateMachine to handle.
enum MenuAction {
  MENU_NONE,
  MENU_START_SESSION,
  MENU_ENTER_PAIRING,
  MENU_ENTER_DIAGNOSTICS,
  MENU_RESUME_SESSION,
  MENU_END_SESSION,
  MENU_PAUSE_SESSION,
  MENU_RESUME_CHECKPOINT,
  MENU_DISCARD_CHECKPOINT,
  MENU_START_CYCLE,
  MENU_SKIP_CYCLE,
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
           /*nudges*/ true, /*autoPause*/ true, /*pauseIdx*/ 0, /*endIdx*/ 0,
           /*quietStart*/ 0xFFFF, /*quietEnd*/ 0xFFFF,
           /*dailyGoal*/ 180 };
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
