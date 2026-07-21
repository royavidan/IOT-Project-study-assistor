#pragma once
// ============================================================================
// Touch (input) — XPT2046 reads with persistent corner calibration.
// Compiled only in the USE_TOUCH build.
// ============================================================================
#include "config.h"
#if USE_TOUCH

namespace Touch {
  // TAP and DRAG_* are emitted on finger release; LONG_PRESS fires once mid-hold when the
  // finger is held still past the long-press time (so a hold resolves to Back instead of a
  // tap-on-release, and a drag never fires a tap).
  enum Gesture { G_NONE, G_TAP, G_DRAG_UP, G_DRAG_DOWN, G_LONG_PRESS };

  void begin();                  // load saved calibration, or run it once if none
  void calibrate();              // interactive corner calibration -> applied + saved to NVS
  void diagnose();               // ~12s live probe: draws a crosshair where the touch maps +
                                 // prints raw/mapped coords (so a bad calibration is visible)
  void setRawMode(bool on);      // keyboard/raw-tap mode: every release is a TAP at the down
                                 // point (no drag, no long-press) so a key press is never lost
  Gesture poll(int& x, int& y);  // G_NONE until a gesture completes; x/y = tap point
}

#endif
