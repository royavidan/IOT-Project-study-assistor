#pragma once
// ============================================================================
// LedRing — WS2812B status ring (the "eyes-off" surface). STUBBED until the
// ring is wired (HAS_LED_RING). All calls are safe no-ops while absent, so the
// rest of the firmware already drives it — just flip the flag + set the pin.
// NOTE: a WS2812B ring wants 5V power + ~470R data resistor + 1000uF cap; the
// 3.3V GPIO data line is marginal and may need a level shifter.
// ============================================================================
#include "types.h"

namespace LedRing {
  void init();
  void show(SysState st, Mode m, float frac);     // frac = remaining 0..1
  void status(uint8_t r, uint8_t g, uint8_t b);   // solid color (boot/error)
}
