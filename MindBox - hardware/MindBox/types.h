#pragma once
// ============================================================================
// types.h — shared enums, structs, and tiny inline helpers used across modules.
// Mirrors the cloud contracts in mindbox-companion-forge-main/src/lib/focus-load.ts.
// ============================================================================
#include <Arduino.h>
#include <time.h>

// Device state machine (see StateMachine + the Tactile Interaction Model doc).
enum SysState {
  ST_BOOTING, ST_IDLE, ST_SETUP, ST_ARMED, ST_RUNNING,
  ST_PAUSED, ST_COMPLETE, ST_LOGGING, ST_ERROR, ST_DIAG
};

enum Mode { MODE_WORK, MODE_BREAK };

// Settings the companion site can push down to the box (config downlink).
struct DeviceConfig {
  bool     showTimer;        // OLED shows MM:SS during a session? (your site toggle)
  bool     hapticsEnabled;   // user_settings.haptics_enabled
  bool     adaptiveCoaching; // user_settings.adaptive_coaching_enabled (Story 16)
  bool     nudgesEnabled;    // user_settings.notifications_enabled (Story 12)
  uint16_t quietStartMin;    // minutes-from-midnight, 0xFFFF = unset
  uint16_t quietEndMin;
  uint16_t dailyGoalMin;     // profiles.daily_goal_min
};

// One in-session telemetry sample (Story 8/10), kept in RAM for live upload.
struct Sample {
  uint16_t t;        // seconds since session start
  uint8_t  fle;      // Focus Load Estimate 0..100 at time t
  float    noise;    // normalized 0..1
  float    tempC;    // NAN if no temp sensor
  float    lightLux;
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
  int      actualFocusMin;
  bool     wifi;
  bool     present;
};

// Minimal telemetry heartbeat payload (Story 15/17).
struct TelemetryModel {
  const char* state;
  int         batteryPct;
  int         wifiRssi;
};

inline const char* modeName(Mode m) { return m == MODE_WORK ? "WORK" : "BREAK"; }

inline DeviceConfig defaultConfig() {
  return { /*showTimer*/ true, /*haptics*/ true, /*adaptive*/ false,
           /*nudges*/ true, /*quietStart*/ 0xFFFF, /*quietEnd*/ 0xFFFF,
           /*dailyGoal*/ 180 };
}
