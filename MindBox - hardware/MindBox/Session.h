#pragma once
// ============================================================================
// Session — one focus session's timing, environment sampling, and FLE.
// Countdown runs on esp_timer (10 ms) so main-loop stalls don't skip time.
// ============================================================================
#include "types.h"
#include <time.h>

namespace Session {
  void start(Mode m, int durationMin, time_t startEpoch);
  void tick(bool present);     // presence flag + periodic env sampling
  void setSamplePeriodMs(unsigned long ms);  // 0 = paused / off
  unsigned long samplePeriodMs();
  void pauseClock();           // ST_PAUSED — timer stops, session stays armed
  void resumeClock();          // ST_RUNNING again
  void stopClock();            // session ended — stop esp_timer

  bool finished();             // remaining <= 0
  void addBreak();
  void addPresenceInterruption();

  int  remainingMs();
  int  remainingSec();
  int  targetSec();
  int  actualFocusSec();
  int  actualFocusMin();
  int  breaks();
  int  presenceInterruptions();
  int  lastFle();              // most recent sampled estimate (Story 16)

  const Sample* samples();
  int  sampleCount();

  SessionRecord finish(const char* status, time_t endEpoch, uint32_t seq);

  void restore(const SessionCheckpoint& cp);
  void alignSampleTimer();     // call after cold-boot resume (millis() reset)
  SessionCheckpoint snapshot(SysState sysState);
  Mode mode();
}
