#include "Diagnostics.h"
#include "config.h"
#include "types.h"
#include "Sensors.h"
#include "Audio.h"
#include "Session.h"
#include "StateMachine.h"
#include "Storage.h"
#include "Display.h"
#include "Cloud.h"
#include "UploadQueue.h"
#include "Inputs.h"
#include <ESP.h>
#include <esp_system.h>
#include <math.h>

static bool     s_monitor = false;
static uint32_t s_lastMon = 0;

static const char* stName(SysState s) {
  switch (s) {
    case ST_BOOTING:  return "BOOT";
    case ST_IDLE:     return "IDLE";
    case ST_RUNNING:  return "RUNNING";
    case ST_PAUSED:   return "PAUSED";
    case ST_COMPLETE: return "COMPLETE";
    case ST_LOGGING:  return "LOGGING";
    case ST_ERROR:    return "ERROR";
    case ST_PAIRING:  return "PAIRING";
    case ST_DIAG:     return "DIAG";
    case ST_RESUME:   return "RESUME";
    case ST_CYCLE_OFFER: return "CYCLE";
    default:          return "?";
  }
}

static void formatTemp(float tempC, char* out, size_t outLen) {
  if (isnan(tempC)) snprintf(out, outLen, "--");
  else snprintf(out, outLen, "%.1f", tempC);
}

static void dump() {
  int s = Session::remainingSec();
  SysState st = StateMachine::state();
  bool inSession = st == ST_RUNNING || st == ST_PAUSED;
  char tempBuf[12];
  if (inSession) {
    float lux = 0, lvar = 0, tempC = NAN;
    Sensors::readLight(lux, lvar);
    Sensors::readTemp(tempC);
    formatTemp(tempC, tempBuf, sizeof(tempBuf));
    Serial.printf(
      "[mon] state=%-7s timer=%02d:%02d mode=%-5s present=%d dist=%dmm "
      "noise=%.2f lux=%.0f temp=%s tof=%s wifi=%s btn=%d/%d fault=%d buf=%d pending=--\n",
      stName(st), s / 60, s % 60, modeName(StateMachine::mode()),
      Sensors::present() ? 1 : 0, Sensors::presenceMm(), Sensors::noise(), lux,
      tempBuf,
      Sensors::health().tofPresent ? "ok" : "absent",
      Cloud::online() ? "on" : "off",
      Inputs::sidePressed() ? 1 : 0, Inputs::sideRaw(),
      Inputs::sideFault() ? 1 : 0,
      Storage::bufferedCount());
  } else {
    float lux = 0, lvar = 0, tempC = NAN;
    Sensors::readLight(lux, lvar);
    Sensors::readTemp(tempC);
    formatTemp(tempC, tempBuf, sizeof(tempBuf));
    Serial.printf(
      "[mon] state=%-7s timer=%02d:%02d mode=%-5s present=%d dist=%dmm "
      "noise=%.2f lux=%.0f temp=%s tof=%s wifi=%s btn=%d/%d fault=%d buf=%d pending=%d\n",
      stName(st), s / 60, s % 60, modeName(StateMachine::mode()),
      Sensors::present() ? 1 : 0, Sensors::presenceMm(), Sensors::noise(), lux,
      tempBuf,
      Sensors::health().tofPresent ? "ok" : "absent",
      Cloud::online() ? "on" : "off",
      Inputs::sidePressed() ? 1 : 0, Inputs::sideRaw(),
      Inputs::sideFault() ? 1 : 0,
      Storage::bufferedCount(),
      UploadQueue::pendingCount());
  }
}

static void queueStatus() {
  Serial.printf("[queue] pending=%d oldest=%08u dropped=%d\n",
                UploadQueue::pendingCount(),
                UploadQueue::peekOldestSeq(),
                UploadQueue::hasDropped() ? 1 : 0);
}

static void printCalibration() {
  Serial.println();
  Serial.println("[cal] Sensor calibration (NVS):");
  Serial.printf("  noise scale : %.0f  (ADC p-p -> 1.0; default %.0f)\n",
                Storage::noiseFullScale(), NOISE_FULL_SCALE_DEFAULT);
  Serial.printf("  noise dBoff : %.1f  (-> dB SPL; default %.1f; live %.0f dB)\n",
                Storage::noiseDbOffset(), NOISE_DB_OFFSET_DEFAULT, Sensors::noiseDb());
  Serial.printf("  light lux   : %.0f  (ADC -> lux; default %.0f)\n",
                Storage::lightLuxScale(), LIGHT_LUX_SCALE_DEFAULT);
  Serial.printf("  light var   : %.0f  (ADC p-p -> FLE; default %.0f)\n",
                Storage::lightVarScale(), LIGHT_VAR_SCALE_DEFAULT);
  Serial.printf("  temp offset : %.1f C  (default %.1f)\n",
                Storage::tempOffsetC(), TEMP_OFFSET_DEFAULT);
  Serial.printf("  live noise  : %.2f  light: %.0f lux  temp: ",
                Sensors::noiseProbe(50));
  float lux = 0, lvar = 0, tempC = NAN;
  Sensors::readLight(lux, lvar);
  Sensors::readTemp(tempC);
  if (isnan(tempC)) Serial.println("--");
  else Serial.printf("%.1f C\n", tempC);
  Serial.println("[cal] Set: c noise 1800 | c db 55 | c light 1200 | c lightvar 2000 | c temp -1.5 | c reset");
  Serial.println();
}

static void applyCalibrationArgs(const String& args) {
  if (args.length() == 0 || args == "reset") {
    Storage::resetSensorCalibration();
    Sensors::reloadCalibration();
    Serial.println("[cal] reset to defaults");
    printCalibration();
    return;
  }
  int sp = args.indexOf(' ');
  if (sp < 0) {
    Serial.println("[cal] usage: c noise|db|light|lightvar|temp <value>  |  c reset");
    return;
  }
  String key = args.substring(0, sp);
  String valStr = args.substring(sp + 1);
  valStr.trim();
  float val = valStr.toFloat();
  key.toLowerCase();

  if (key == "noise") {
    Storage::setNoiseFullScale(val);
    Sensors::reloadCalibration();
    Serial.printf("[cal] noise scale -> %.0f (live %.2f)\n",
                  Storage::noiseFullScale(), Sensors::noiseProbe(50));
  } else if (key == "db") {
    // Calibrate dB SPL: shift the offset so the live reading matches the reference level the user
    // measured with a phone sound-meter app next to the box. val = that reference level in dB.
    float err = val - Sensors::noiseDb();
    Storage::setNoiseDbOffset(Storage::noiseDbOffset() + err);
    Serial.printf("[cal] noise dB offset -> %.1f (now reads ~%.0f dB)\n",
                  Storage::noiseDbOffset(), Sensors::noiseDb());
  } else if (key == "light") {
    Storage::setLightLuxScale(val);
    Sensors::reloadCalibration();
    float lux = 0, lvar = 0;
    Sensors::readLight(lux, lvar);
    Serial.printf("[cal] light lux scale -> %.0f (live ~%.0f lux)\n",
                  Storage::lightLuxScale(), lux);
  } else if (key == "lightvar") {
    Storage::setLightVarScale(val);
    Sensors::reloadCalibration();
    float lux = 0, lvar = 0;
    Sensors::readLight(lux, lvar);
    Serial.printf("[cal] light var scale -> %.0f (live var %.2f)\n",
                  Storage::lightVarScale(), lvar);
  } else if (key == "temp") {
    Storage::setTempOffsetC(val);
    float tempC = NAN;
    Sensors::readTemp(tempC);
    Serial.printf("[cal] temp offset -> %.1f C (live %.1f C)\n",
                  Storage::tempOffsetC(), isnan(tempC) ? 0.0f : tempC);
  } else {
    Serial.println("[cal] unknown key — use noise, db, light, lightvar, temp, or reset");
  }
}

static void handleCalibCommand() {
  delay(30);
  if (Serial.available()) {
    String rest = Serial.readStringUntil('\n');
    rest.trim();
    applyCalibrationArgs(rest);
  } else {
    printCalibration();
  }
}

static void buttonLiveTest() {
  Serial.println();
  Serial.printf("[btn] Live test GPIO%d — open=1 pressed=0. Press/release for 8s...\n",
                PIN_BUTTON);
  uint32_t end = millis() + 8000;
  int last = -1;
  bool sawOpen = false, sawPress = false;
  while ((int32_t)(millis() - end) < 0) {
    Inputs::poll();
    int r = Inputs::sideRaw();
    if (r == 1) sawOpen = true;
    if (r == 0) sawPress = true;
    if (r != last) {
      Serial.printf("[btn] raw=%d  (%s)\n", r, r ? "OPEN (released)" : "PRESSED");
      last = r;
    }
    delay(20);
  }
  if (!sawOpen)
    Serial.println("[btn] NEVER saw raw=1 — pin stuck LOW. Fix wiring (diagonal tact pins).");
  else if (!sawPress)
    Serial.println("[btn] NEVER saw raw=0 — press not reaching GPIO4.");
  else
    Serial.println("[btn] OK — button toggles correctly.");
  Serial.println();
}

namespace Diagnostics {

static const char* resetReasonStr(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON:  return "power-on";
    case ESP_RST_SW:       return "software";
    case ESP_RST_PANIC:    return "panic/crash";
    case ESP_RST_INT_WDT:  return "int-wdt";
    case ESP_RST_TASK_WDT: return "task-wdt";
    case ESP_RST_WDT:      return "wdt";
    case ESP_RST_BROWNOUT: return "brownout";
    default:               return "other";
  }
}

const char* resetReason() { return resetReasonStr(esp_reset_reason()); }

void selfTest() {
  Serial.println();
  Serial.println("==== MindBox self-test ====");
  Serial.printf("firmware : %s\n", FW_VERSION);
  Serial.printf("reset    : %s\n", resetReasonStr(esp_reset_reason()));
  Serial.printf("heap     : %u free / %u total\n", ESP.getFreeHeap(), ESP.getHeapSize());
  Serial.printf("psram    : %s  %u bytes  (set Arduino PSRAM=\"OPI PSRAM\")\n",
                psramFound() ? "OPI ok" : "OFF/none", (unsigned)ESP.getPsramSize());
  Serial.printf("device   : %s\n", Storage::deviceId().c_str());
  uint8_t addrs[8];
  int n = Sensors::i2cScan(addrs, 8);
  Serial.print("i2c scan :");
  if (n == 0) Serial.print(" (none)");
  for (int i = 0; i < n; i++) Serial.printf(" 0x%02X", addrs[i]);
  Serial.println();
  Serial.printf("oled     : %s\n", Display::present() ? Display::driverName() : "NOT FOUND");
  SensorHealth h = Sensors::health();
  Serial.printf("tof(pres): %s  dist=%dmm\n", h.tofPresent ? "ok" : "absent", Sensors::presenceMm());
  Serial.printf("mic      : %.2f normalized (live probe)\n", Sensors::noiseProbe());
  Audio::probe();   // ES8311 boot-ACK + raw I2S min/max/RMS (mic bring-up)
  float lux = 0, lvar = 0, tempC = NAN;
  bool hasLux = Sensors::readLight(lux, lvar);
  bool hasTemp = Sensors::readTemp(tempC);
  if (hasLux)
    Serial.printf("light    : ok  ~%.0f lux  var=%.2f\n", lux, lvar);
  else
    Serial.printf("light    : %s\n", HAS_LIGHT ? "invalid" : "absent");
  if (hasTemp)
    Serial.printf("temp     : ok  %.1f C\n", tempC);
  else if (HAS_TEMP)
    Serial.printf("temp     : invalid  (DHT11: add 4.7k-10k pull-up DATA(IO%d)->3V3; check wiring)\n", PIN_DHT11);
  else
    Serial.println("temp     : absent");
  Serial.printf("wifi     : %s\n", Cloud::online() ? "connected" : "off");
  Serial.printf("side btn : GPIO%d raw=%d at boot", PIN_BUTTON, Inputs::sideRaw());
#if BTN_ACTIVE_LOW
  if (Inputs::sideRaw() == 0)
    Serial.print("  ** STUCK LOW — fix wiring **");
  else
    Serial.print("  (ok: open=1, pressed=0)");
#endif
  Serial.println();
  if (Inputs::sideFault())
    Serial.println("         6x6x3.6 tact: use opposite-corner pins, not same-side pair.");
  Serial.printf("calib    : noise=%.0f light=%.0f lightvar=%.0f tempOff=%.1f C\n",
                Storage::noiseFullScale(), Storage::lightLuxScale(),
                Storage::lightVarScale(), Storage::tempOffsetC());
  Serial.println("commands : m=monitor  c=calib  a=audio  b=btn  w=wifi  q=queue  d=dump  h=help");
  Serial.println("===========================");
}

void setMonitor(bool on)  { s_monitor = on; Serial.printf("[mon] %s\n", on ? "ON" : "OFF"); }
bool monitorActive()      { return s_monitor; }

void tick() {
  while (Serial.available()) {
    char c = Serial.read();
    if      (c == 'm') setMonitor(!s_monitor);
    else if (c == 'b') buttonLiveTest();
    else if (c == 'd') dump();
    else if (c == 'q') queueStatus();
    else if (c == 'w') Cloud::provisionFromSerial();
    else if (c == 'c') handleCalibCommand();
    else if (c == 'a') Audio::probe();
    else if (c == 'h') Serial.println("[diag] m=monitor  c=calib  a=audio  b=btn  w=wifi  q=queue  d=dump  h=help");
  }
  if (s_monitor && millis() - s_lastMon > 1000) { s_lastMon = millis(); dump(); }
}

} // namespace Diagnostics
