#pragma once
// ============================================================================
// StateMachine — the box's brain. Ties Inputs + Sensors + Session + Display +
// Haptics + LedRing + Storage + Cloud together and runs the state diagram from
// the Tactile Interaction Model. The .ino just calls init() then tick().
// ============================================================================
#include "types.h"

namespace StateMachine {
  void init();
  void tick();                 // one cycle: read inputs, run FSM, render

  SysState state();
  Mode     mode();
  int      durationMin();

  const DeviceConfig& config();
  void applyConfig(const DeviceConfig& c);   // from Storage or Cloud downlink
}
