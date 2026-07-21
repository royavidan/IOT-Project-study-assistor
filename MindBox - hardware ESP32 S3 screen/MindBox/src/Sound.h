#pragma once
// ============================================================================
// Sound — speaker event chimes, mirroring Haptics for the session lifecycle.
// Each helper enqueues a short tone sequence on the ES8311/FM8002E speaker via
// Audio::playChime(). Gated by DeviceConfig.soundEnabled (+ soundLevel volume);
// muted in quiet hours by the same StateMachine gate that mutes Haptics. On top
// of that, each chime KIND is gated by its bit in the site-downlinked chimeMask
// (0xFF = everything audible, the offline/unpaired default).
// ============================================================================
#include <Arduino.h>

namespace Sound {
  // chimeMask bits (mirrors the /ingest/config contract).
  constexpr uint8_t CHIME_BIT_LIFECYCLE = 0x01;  // start / pause / resume
  constexpr uint8_t CHIME_BIT_COMPLETE  = 0x02;  // interval / set complete
  constexpr uint8_t CHIME_BIT_SCHED     = 0x04;  // scheduled auto-start splash
  constexpr uint8_t CHIME_BIT_ALERT     = 0x08;  // environment / interference alert

  void init();                 // call after Audio::begin()
  void setEnabled(bool e);     // driven by DeviceConfig.soundEnabled / quiet hours
  void setVolume(uint8_t level); // 0=low 1=med 2=high (DeviceConfig.soundLevel)
  void setChimeMask(uint8_t mask); // per-kind gate (site downlink; 0xFF default)
  void setDnd(bool on);        // exam mode: mute every chime below (ring exempt)

  void start();     // focus/break interval begins
  void pause();     // manual / presence / nudge pause
  void resume();    // resume from pause
  void complete();  // interval / set complete
  void autoStart(); // scheduled auto-start splash raised
  void alert();     // persistent environment interference
  void test();      // settings: Test sound (always plays, like Haptics::testPulse)
  void ring();      // find-my: insistent MAX-volume chime, bypasses EVERY gate
}
