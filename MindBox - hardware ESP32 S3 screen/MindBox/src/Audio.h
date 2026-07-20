#pragma once
// ============================================================================
// Audio — onboard ES8311 codec (+ FM8002E amp) on the I2S bus.
//
//   • Microphone (ADC, DIN=IO6): a dedicated core-0 task reads I2S frames and
//     publishes a rolling ~1 Hz RMS as micLevel() 0..1 — this feeds the existing
//     Sensors::noise() pipeline (interference alerts, session stats, telemetry).
//   • Speaker  (DAC, DOUT=IO8 -> FM8002E amp, AMP_EN=IO1 active-low): playChime()
//     enqueues a short synthesized tone sequence; the amp is enabled only while a
//     chime plays. Volume is software sample-scaling (no codec re-writes).
//
//   The ES8311 control bus is I2C 0x18 on the SAME pins as touch (IO16/IO15). It
//   is configured once in begin() via software-I2C, BEFORE LovyanGFX claims the
//   bus in Display::init(); at runtime audio is I2S-only, so there is no contention
//   with the FT6336 touch controller. Call begin() before Display::init().
// ============================================================================
#include <Arduino.h>

namespace Audio {
  enum Chime : uint8_t {
    CHIME_START = 0, CHIME_PAUSE, CHIME_RESUME, CHIME_COMPLETE, CHIME_TEST,
    CHIME_SCHED,   // scheduled auto-start splash (rising arpeggio)
    CHIME_ALERT,   // environment/interference attention (double beep + high hold)
    CHIME_RING     // find-my: insistent repeat, always played at MAX amplitude
  };

  void  begin();                 // I2S up + ES8311 config + audio task (pre-Display)
  float micLevel();              // normalized 0..1 (rolling ~1 Hz RMS), 0 if no mic
  bool  micReady();              // true once the codec/mic has produced real data
  void  playChime(uint8_t kind); // enqueue a chime (thread-safe; no-op if no speaker)
  void  setVolume(uint8_t level);// 0=low 1=med 2=high chime volume (software gain)
  void  probe();                 // print mic diagnostics to Serial (codec ACK + raw I2S RMS)

  // On-screen diagnostics (Device -> Diagnostics) — read codec/mic state without a serial cable.
  bool  codecAcked();            // did the ES8311 ACK over soft-I2C at boot?
  int   rawPeakToPeak();         // last ~1s window raw (max-min); jumps when sound hits the mic
  float micRms();                // last ~1s window AC RMS in raw counts (DC removed)
}
