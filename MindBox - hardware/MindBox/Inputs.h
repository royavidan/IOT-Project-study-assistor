#pragma once
// ============================================================================
// Inputs — all physical controls: KY-040 encoder, side button, optional SPDT.
// Call poll() once per loop; the getters return that tick's latched events.
// ============================================================================
#include "types.h"

enum InputMode { INPUT_MENU, INPUT_DURATION };

namespace Inputs {
  void init();
  void poll();                 // read hardware once; latch events for this tick

  void setInputMode(InputMode m);  // menu scroll vs duration edit boundaries

  bool rotated();              // encoder moved since last poll
  int  rotationDir();          // -1, 0, +1 when rotated (for menu cursor)
  int  minutes();              // current duration (5-min steps, clamped)
  void setMinutes(int m);      // sync encoder to a value (e.g. restored default)

  bool knobClicked();          // shaft button (unused in menu UI; ignored)
  int  button();               // side button: 0 none, 1 short=select, 2 long=back

  bool sidePressed();          // debounced, true while tact switch held
  int  sideRaw();              // live digitalRead (diagnostics / wiring check)
  bool sideFault();            // true if pin stuck (always reads pressed)

  bool spdtPresentWork();      // true = Work (only meaningful if USE_SPDT_TOGGLE)
}
