#pragma once
// ============================================================================
// Cloud — Wi-Fi + companion-app link.
// Mirrors the app's device contract:
//   POST /ingest/telemetry   heartbeat (state, battery, rssi, sensor_health)
//   POST /ingest/sessions    completed sessions + samples (idempotent)
//   POST /ingest/pairing     publish the 6-digit claim code
//   GET  /ingest/config      pull DeviceConfig (the site->box DOWNLINK)
// All header `x-device-secret: <DEVICE_INGEST_SECRET>`.
// Completed sessions are enqueued to LittleFS first; tick() drains the queue.
// ============================================================================
#include "types.h"
#include <time.h>

namespace Cloud {
  void begin();
  void tick(SysState sysState = ST_IDLE);
  void kickUpload();
  bool online();
  int  wifiRssi();

  bool   haveClock();          // true once NTP has set real time
  time_t nowEpoch();           // 0 if no clock yet

  void sendTelemetry(const TelemetryModel& t, const String& healthJson);
  bool uploadSession(const SessionRecord& r, const Sample* samples, int n);
  bool uploadSessionJson(uint32_t clientSeq, const String& json);
  bool fetchConfig(DeviceConfig& cfg);          // config downlink (overlays cfg)
  void publishPairingCode(const char* code);

  // Serial-guided provisioning ('w' in Diagnostics): Wi-Fi SSID/pass + app URL +
  // device secret, saved to NVS. Captive portal can replace this later.
  void provisionFromSerial();
}
