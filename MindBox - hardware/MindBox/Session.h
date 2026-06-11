#pragma once
// ============================================================================
// Session — one focus session's timing, environment sampling, and FLE.
// Owns the countdown, the per-minute Sample buffer, and produces the final
// SessionRecord. Knows nothing about screens or the FSM.
// ============================================================================
#include "types.h"
#include <time.h>

namespace Session {
  void start(Mode m, int durationMin, time_t startEpoch);
  void tick(bool present);     // advance timer (only while present) + sample
  void markResumed();          // reset the tick clock after a pause

  bool finished();             // remaining <= 0
  void addBreak();
  void addPresenceInterruption();

  int  remainingMs();
  int  remainingSec();
  int  targetSec();
  int  actualFocusSec();
  int  actualFocusMin();
  int  lastFle();              // most recent sampled estimate (Story 16)

  const Sample* samples();
  int  sampleCount();

  SessionRecord finish(const char* status, time_t endEpoch, uint32_t seq);
}
