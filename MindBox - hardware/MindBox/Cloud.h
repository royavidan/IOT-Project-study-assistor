#pragma once
// ============================================================================
// Cloud — Wi-Fi + companion-app link. STUBBED until ENABLE_WIFI/ENABLE_CLOUD.
// Mirrors the app's device contract:
//   POST /ingest/telemetry   heartbeat (state, battery, rssi, sensor_health)
//   POST /ingest/sessions    completed sessions + samples (idempotent)
//   POST /ingest/pairing     publish the 6-digit claim code   (NEW endpoint)
//   GET  /ingest/config      pull DeviceConfig (the site->box DOWNLINK)
// All header `x-device-secret: <DEVICE_INGEST_SECRET>`.
// ============================================================================
#include "types.h"
#include <time.h>

namespace Cloud {
  void begin();
  void tick();
  bool online();
  int  wifiRssi();

  bool   haveClock();          // true once NTP has set real time
  time_t nowEpoch();           // 0 if no clock yet

  void sendTelemetry(const TelemetryModel& t, const String& healthJson);
  bool uploadSession(const SessionRecord& r, const Sample* samples, int n);
  bool fetchConfig(DeviceConfig& cfg);          // config downlink (overlays cfg)
  void publishPairingCode(const char* code);

  // Serial-guided provisioning ('w' in Diagnostics): Wi-Fi SSID/pass + app URL +
  // device secret, saved to NVS. Captive portal can replace this later.
  void provisionFromSerial();
}
