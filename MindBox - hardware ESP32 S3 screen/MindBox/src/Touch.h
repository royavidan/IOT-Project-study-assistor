#pragma once
// ============================================================================
// Touch (input) — XPT2046 reads with persistent corner calibration.
// Compiled only in the USE_TOUCH build.
// ============================================================================
#include "config.h"
#if USE_TOUCH

namespace Touch {
  // A gesture is emitted once, on finger release, so a drag never fires a tap.
  enum Gesture { G_NONE, G_TAP, G_DRAG_UP, G_DRAG_DOWN };

  void begin();                  // load saved calibration, or run it once if none
  void calibrate();              // interactive corner calibration -> applied + saved to NVS
  Gesture poll(int& x, int& y);  // G_NONE until a gesture completes; x/y = tap point
}

#endif
