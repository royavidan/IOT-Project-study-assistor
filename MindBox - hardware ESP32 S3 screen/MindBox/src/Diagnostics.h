#pragma once
// ============================================================================
// Diagnostics — your "monitor things" option, over the serial console (115200).
//   selfTest()  : one-shot boot report — firmware, device id, I2C scan, which
//                 OLED, ToF presence, mic level, Wi-Fi. (Sensor *connection*.)
//   tick()      : reads single-key commands and, when the live monitor is on,
//                 streams a status line every second:
//                   state, timer MM:SS, mode, present, distance, noise, tof, wifi
//   Commands (type in Serial Monitor): m=toggle monitor  d=one-shot dump  h=help
// There is ALSO an on-box screen: Device -> Diagnostics in the pointer menu (ST_DIAG).
// ============================================================================

namespace Diagnostics {
  void selfTest();
  void tick();
  bool monitorActive();
  void setMonitor(bool on);
}
