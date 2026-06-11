#include "Diagnostics.h"
#include "config.h"
#include "types.h"
#include "Sensors.h"
#include "Session.h"
#include "StateMachine.h"
#include "Storage.h"
#include "Display.h"
#include "Cloud.h"

static bool     s_monitor = false;
static uint32_t s_lastMon = 0;

static const char* stName(SysState s) {
  switch (s) {
    case ST_BOOTING:  return "BOOT";
    case ST_IDLE:     return "IDLE";
    case ST_SETUP:    return "SETUP";
    case ST_ARMED:    return "ARMED";
    case ST_RUNNING:  return "RUNNING";
    case ST_PAUSED:   return "PAUSED";
    case ST_COMPLETE: return "COMPLETE";
    case ST_LOGGING:  return "LOGGING";
    case ST_ERROR:    return "ERROR";
    case ST_DIAG:     return "DIAG";
    default:          return "?";
  }
}

static void dump() {
  int s = Session::remainingSec();
  Serial.printf(
    "[mon] state=%-7s timer=%02d:%02d mode=%-5s present=%d dist=%dmm "
    "noise=%.2f tof=%s wifi=%s buf=%d\n",
    stName(StateMachine::state()), s / 60, s % 60, modeName(StateMachine::mode()),
    Sensors::present() ? 1 : 0, Sensors::presenceMm(), Sensors::noise(),
    Sensors::health().tofPresent ? "ok" : "absent",
    Cloud::online() ? "on" : "off", Storage::bufferedCount());
}

namespace Diagnostics {

void selfTest() {
  Serial.println();
  Serial.println("==== MindBox self-test ====");
  Serial.printf("firmware : %s\n", FW_VERSION);
  Serial.printf("device   : %s\n", Storage::deviceId().c_str());
  uint8_t addrs[8];
  int n = Sensors::i2cScan(addrs, 8);
  Serial.print("i2c scan :");
  if (n == 0) Serial.print(" (none)");
  for (int i = 0; i < n; i++) Serial.printf(" 0x%02X", addrs[i]);
  Serial.println();
  Serial.printf("oled     : %s\n", Display::present() ? Display::driverName() : "NOT FOUND");
  SensorHealth h = Sensors::health();
  Serial.printf("tof(pres): %s\n", h.tofPresent ? "ok" : "absent");
  Serial.printf("mic      : %.2f normalized (live probe)\n", Sensors::noiseProbe());
  Serial.printf("light    : %s\n", h.lightPresent ? "ok" : "absent (stub)");
  Serial.printf("temp     : %s\n", h.tempPresent ? "ok" : "absent (stub)");
  Serial.printf("wifi     : %s\n", Cloud::online() ? "connected" : "off");
  Serial.println("commands : m=monitor  d=dump  h=help");
  Serial.println("===========================");
}

void setMonitor(bool on)  { s_monitor = on; Serial.printf("[mon] %s\n", on ? "ON" : "OFF"); }
bool monitorActive()      { return s_monitor; }

void tick() {
  while (Serial.available()) {
    char c = Serial.read();
    if      (c == 'm') setMonitor(!s_monitor);
    else if (c == 'd') dump();
    else if (c == 'h') Serial.println("[diag] m=monitor toggle, d=one-shot dump, h=help");
  }
  if (s_monitor && millis() - s_lastMon > 1000) { s_lastMon = millis(); dump(); }
}

} // namespace Diagnostics
