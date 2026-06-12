#pragma once
// ============================================================================
// Haptics — non-blocking vibration-motor pattern player (PIN_HAPTIC, via transistor).
// Patterns come from the Control->Feedback table. Respects cfg.hapticsEnabled.
// Call tick() every loop; the named helpers fire a pattern and return at once.
// ============================================================================
#include <Arduino.h>

namespace Haptics {
  void init();
  void tick();                 // advance the active pattern (call every loop)
  void setEnabled(bool e);     // driven by DeviceConfig.hapticsEnabled

  void play(const uint16_t* steps, uint8_t len);  // on,off,on,... durations (ms)
  void stopAll();

  void tap();       // confirm / start          (1 short)
  void click();     // menu detent              (1 very short)
  void enableTest(); // settings: haptics ON confirmation pulse
  void testPulse();  // settings: Test motor (always fires, for wiring check)
  void wiringTest(); // serial diag: tries both GPIO polarities
  bool isHolding();  // true while Test motor / enable confirm is running
  void pause();     // presence-loss / break    (2 short)
  void resume();    // presence-return          (1 long)
  void complete();  // timer end                (strong alert)
  void reset();     // long-press reset
}
