#pragma once
// ============================================================================
// Keyboard — a minimal on-screen touch keyboard (Nothing-styled) for entering a
// Wi-Fi password / SSID on the TFT. Driven by absolute tap coordinates (via
// Inputs raw-tap mode). QWERTY + a 123/symbols layer, shift, space, backspace,
// done, cancel; optional masked display for passwords.
// ============================================================================
#include "config.h"
#if USE_TOUCH

namespace Keyboard {
  void begin(const char* title, bool masked);  // open with a prompt; clears the buffer
  void handleTap(int x, int y);                 // feed one tap (sets done/cancel or edits text)
  void render();                                // draw the whole keyboard (call when dirty)
  const char* text();                           // current entry
  bool done();                                  // user pressed Done
  bool cancelled();                             // user pressed Cancel
  bool dirty();                                 // needs a redraw since last render()
}

#endif
