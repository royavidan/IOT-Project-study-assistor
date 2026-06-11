#include "Cloud.h"
#include "config.h"

#if ENABLE_WIFI
#include <WiFi.h>
#include <time.h>
#if ENABLE_CLOUD
#include <HTTPClient.h>
// TODO (set via captive portal / NVS, not hard-coded):
//   static const char* APP_BASE_URL = "http://192.168.1.10:8080";
//   static const char* DEVICE_SECRET = "...";   // == server DEVICE_INGEST_SECRET
#endif
#endif

namespace Cloud {

void begin() {
#if ENABLE_WIFI
  // TODO: captive portal join (e.g. WiFiManager); on success:
  //   configTime(0, 0, "pool.ntp.org");   // NTP -> real timestamps (Story 4)
#endif
}

void tick() { /* reserved: retry queued uploads, refresh config periodically */ }

bool online() {
#if ENABLE_WIFI
  return WiFi.status() == WL_CONNECTED;
#else
  return false;
#endif
}

int wifiRssi() {
#if ENABLE_WIFI
  return WiFi.RSSI();
#else
  return 0;
#endif
}

bool haveClock() {
#if ENABLE_WIFI
  return time(nullptr) > 1700000000;   // sane epoch -> NTP has synced
#else
  return false;
#endif
}

time_t nowEpoch() {
#if ENABLE_WIFI
  return time(nullptr);
#else
  return 0;
#endif
}

void sendTelemetry(const TelemetryModel& t, const String& healthJson) {
#if ENABLE_CLOUD
  // TODO: POST {APP_BASE_URL}/ingest/telemetry
  //   { deviceId, ts, state, batteryPct, wifiRssi, sensorHealth, firmwareVersion }
#endif
  (void)t; (void)healthJson;
}

bool uploadSession(const SessionRecord& r, const Sample* samples, int n) {
#if ENABLE_CLOUD
  // TODO: POST {APP_BASE_URL}/ingest/sessions  (array of one SessionPayload),
  //   building focusLoadSamples + envSamples from samples[0..n) — see
  //   scripts/simulator.ts for the exact JSON shape. Return true on HTTP 200.
#endif
  (void)r; (void)samples; (void)n;
  return false;   // not yet synced -> stays in the NVS buffer
}

bool fetchConfig(DeviceConfig& out) {
#if ENABLE_CLOUD
  // TODO: GET {APP_BASE_URL}/ingest/config?deviceId=...  ->
  //   { showTimer, hapticsEnabled, adaptiveCoaching, nudgesEnabled,
  //     quietStartMin, quietEndMin, dailyGoalMin }  -> copy into `out`.
  //   THIS is what makes the site's "show timer on box" toggle (and the rest)
  //   actually control the device. Needs the new app endpoint first.
#endif
  (void)out;
  return false;
}

void publishPairingCode(const char* code) {
#if ENABLE_CLOUD
  // TODO: POST {APP_BASE_URL}/ingest/pairing { deviceId, code, expiresAt }
  //   so the 6-digit code shown on the OLED can be claimed on /device.
#endif
  (void)code;
}

} // namespace Cloud
