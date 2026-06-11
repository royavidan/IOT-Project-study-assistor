#pragma once
// ============================================================================
// Inputs — all physical controls: KY-040 encoder, side button, optional SPDT.
// Call poll() once per loop; the getters return that tick's latched events.
// ============================================================================
#include "types.h"

namespace Inputs {
  void init();
  void poll();                 // read hardware once; latch events for this tick

  bool rotated();              // encoder moved since last poll
  int  minutes();              // current duration (5-min steps, clamped)
  void setMinutes(int m);      // sync encoder to a value (e.g. restored default)

  bool knobClicked();          // shaft button momentary click
  int  button();               // side button: 0 none, 1 short, 2 long (on release)
  bool spdtPresentWork();      // true = Work (only meaningful if USE_SPDT_TOGGLE)
}
