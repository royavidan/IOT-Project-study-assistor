#pragma once
// ============================================================================
// Sound — speaker event chimes, mirroring Haptics for the session lifecycle.
// Each helper enqueues a short tone sequence on the ES8311/FM8002E speaker via
// Audio::playChime(). Gated by DeviceConfig.soundEnabled (+ soundLevel volume);
// muted in quiet hours by the same StateMachine gate that mutes Haptics.
// ============================================================================
#include <Arduino.h>

namespace Sound {
  void init();                 // call after Audio::begin()
  void setEnabled(bool e);     // driven by DeviceConfig.soundEnabled / quiet hours
  void setVolume(uint8_t level); // 0=low 1=med 2=high (DeviceConfig.soundLevel)

  void start();     // focus/break interval begins
  void pause();     // manual / presence / nudge pause
  void resume();    // resume from pause
  void complete();  // interval / set complete
  void test();      // settings: Test sound (always plays, like Haptics::testPulse)
}
