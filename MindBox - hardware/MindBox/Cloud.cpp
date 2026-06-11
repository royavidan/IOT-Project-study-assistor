#include "Cloud.h"
#include "config.h"
#include "Storage.h"
#include "Payload.h"
#include "UploadQueue.h"
#include <ESP.h>

#if ENABLE_WIFI
#include <WiFi.h>
#include <time.h>
#endif
#if ENABLE_CLOUD
#include <HTTPClient.h>
#if CLOUD_USE_TLS
#include <WiFiClientSecure.h>
#endif
#endif

#if ENABLE_WIFI
static String   s_ssid, s_pass, s_baseUrl, s_secret;
static bool     s_ntpStarted = false;
static uint32_t s_lastWifiTry = 0;
static bool     s_cachedOnline = false;
static uint32_t s_lastOnlineCheck = 0;

static bool refreshOnlineCache() {
  uint32_t now = millis();
  if (now - s_lastOnlineCheck >= WIFI_STATUS_CACHE_MS) {
    s_lastOnlineCheck = now;
    s_cachedOnline = (WiFi.status() == WL_CONNECTED);
  }
  return s_cachedOnline;
}

static void loadCreds() {
  s_ssid    = Storage::wifiSsid();
  s_pass    = Storage::wifiPass();
  s_baseUrl = Storage::appBaseUrl();
  s_secret  = Storage::deviceSecret();
  while (s_baseUrl.endsWith("/")) s_baseUrl.remove(s_baseUrl.length() - 1);
}
#endif

#if ENABLE_CLOUD
// Single HTTP entry. Returns the status code (>0) or a negative error.
// `respBody` is filled on a real response. Handles http:// and https:// (TLS
// is accepted without cert pinning — fine for a coursework/LAN dev server).
static uint32_t s_netSuspendUntil = 0;   // skip HTTP until this time after a connect/timeout failure

static int httpRequest(const char* method, const String& url,
                       const String& body, String& respBody) {
  if (s_baseUrl.length() == 0 || s_secret.length() == 0) return -1;
  if ((int32_t)(millis() - s_netSuspendUntil) < 0) return -99;  // backing off an unreachable server
  HTTPClient http;
  WiFiClient plain;
  bool https = url.startsWith("https:");
  bool ok;
#if CLOUD_USE_TLS
  WiFiClientSecure secure;
  if (https) { secure.setInsecure(); ok = http.begin(secure, url); }
  else       { ok = http.begin(plain, url); }
#else
  if (https) { Serial.println("[cloud] https URL needs CLOUD_USE_TLS=1 in config.h"); return -3; }
  ok = http.begin(plain, url);
#endif
  if (!ok) return -2;
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);   // cap the hang on an unreachable host
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("content-type", "application/json");
  http.addHeader("x-device-secret", s_secret);
  int code = (strcmp(method, "POST") == 0) ? http.POST(body) : http.GET();
  if (code > 0) { respBody = http.getString(); s_netSuspendUntil = 0; }
  else s_netSuspendUntil = millis() + NET_FAIL_BACKOFF_MS;  // unreachable -> stop hammering the loop
  http.end();
  return code;
}

// Minimal flat-JSON readers for the trusted /ingest/config response.
static int valuePos(const String& b, const char* key) {
  String pat = String("\"") + key + "\"";
  int k = b.indexOf(pat);
  if (k < 0) return -1;
  int c = b.indexOf(':', k + pat.length());
  if (c < 0) return -1;
  int p = c + 1;
  while (p < (int)b.length() && (b[p] == ' ' || b[p] == '\t')) p++;
  return p;
}
static bool jBool(const String& b, const char* key, bool def) {
  int p = valuePos(b, key);
  if (p < 0) return def;
  if (b.substring(p, p + 4) == "true")  return true;
  if (b.substring(p, p + 5) == "false") return false;
  return def;
}
static long jInt(const String& b, const char* key, long def) {
  int p = valuePos(b, key);
  if (p < 0) return def;
  return strtol(b.c_str() + p, nullptr, 10);
}

static bool     s_uploadSoon = false;
static bool     s_uploadAuthFail = false;
static bool     s_wasOnline = false;
static uint32_t s_lastUploadTry = 0;
static uint32_t s_uploadBackoffMs = UPLOAD_RETRY_MIN_MS;

static void drainUploadQueue() {
  if (s_uploadAuthFail) return;
  if (!Cloud::online() || UploadQueue::pendingCount() == 0) return;
  if (!s_uploadSoon && millis() - s_lastUploadTry < s_uploadBackoffMs) return;

  s_lastUploadTry = millis();
  String json;
  if (!UploadQueue::readOldest(json)) return;

  String body = "[";
  body += json;
  body += "]";
  String resp;
  int code = httpRequest("POST", s_baseUrl + "/ingest/sessions", body, resp);
  if (code == 200) {
    UploadQueue::removeOldest();
    s_uploadBackoffMs = UPLOAD_RETRY_MIN_MS;
    int left = UploadQueue::pendingCount();
    s_uploadSoon = left > 0;
    Serial.printf("[cloud] uploaded session (pending=%d heap=%u)\n", left, ESP.getFreeHeap());
  } else if (code == 401) {
    s_uploadAuthFail = true;
    Serial.println("[cloud] upload auth failed — fix DEVICE_INGEST_SECRET");
  } else {
    Serial.printf("[cloud] upload failed (%d): %s\n", code, resp.c_str());
    if (s_uploadBackoffMs < UPLOAD_RETRY_MAX_MS)
      s_uploadBackoffMs = min(s_uploadBackoffMs * 2, UPLOAD_RETRY_MAX_MS);
    s_uploadSoon = false;
  }
}
#endif // ENABLE_CLOUD

namespace Cloud {

void begin() {
#if ENABLE_WIFI
  loadCreds();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (s_ssid.length()) WiFi.begin(s_ssid.c_str(), s_pass.c_str());
#endif
}

void tick(SysState sysState) {
  const bool sessionActive =
    sysState == ST_RUNNING || sysState == ST_PAUSED;
#if ENABLE_WIFI
  if (sessionActive) {
    refreshOnlineCache();
  } else {
    if (s_ssid.length() && !refreshOnlineCache() &&
        millis() - s_lastWifiTry > WIFI_RETRY_MS) {
      s_lastWifiTry = millis();
      WiFi.begin(s_ssid.c_str(), s_pass.c_str());
    }
    if (refreshOnlineCache() && !s_ntpStarted) {
      configTime(0, 0, NTP_SERVER);
      s_ntpStarted = true;
    }
#if ENABLE_CLOUD
    bool nowOnline = s_cachedOnline;
    if (nowOnline && !s_wasOnline) {
      s_uploadBackoffMs = UPLOAD_RETRY_MIN_MS;
      s_uploadSoon = true;
    }
    s_wasOnline = nowOnline;
#endif
  }
#endif
#if ENABLE_CLOUD
  if (!sessionActive)
    drainUploadQueue();
#else
  (void)sysState;
#endif
}

bool online() {
#if ENABLE_WIFI
  return refreshOnlineCache();
#else
  return false;
#endif
}

int wifiRssi() {
#if ENABLE_WIFI
  return online() ? WiFi.RSSI() : 0;
#else
  return 0;
#endif
}

bool haveClock() {
#if ENABLE_WIFI
  return time(nullptr) > 1700000000L;   // sane epoch -> NTP has synced
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
  if (!online()) return;
  String ts = haveClock() ? Payload::isoFromEpoch(nowEpoch()) : "1970-01-01T00:00:00Z";
  String body = "{";
  body += "\"deviceId\":\"" + Storage::deviceId() + "\",";
  body += "\"ts\":\"" + ts + "\",";
  body += "\"state\":\""; body += (t.state ? t.state : "idle"); body += "\",";
  body += "\"batteryPct\":" + String(t.batteryPct) + ",";
  body += "\"wifiRssi\":" + String(t.wifiRssi) + ",";
  body += "\"sensorHealth\":" + (healthJson.length() ? healthJson : String("null")) + ",";
  body += "\"firmwareVersion\":\"" FW_VERSION "\"";
  body += "}";
  String resp;
  httpRequest("POST", s_baseUrl + "/ingest/telemetry", body, resp);
#else
  (void)t; (void)healthJson;
#endif
}

bool uploadSession(const SessionRecord& r, const Sample* samples, int n) {
#if ENABLE_CLOUD
  String json = Payload::sessionJson(r, samples, n, Storage::deviceId().c_str());
  if (!UploadQueue::enqueueJson(r.clientSeq, json)) return false;
  kickUpload();
  return true;
#else
  (void)r; (void)samples; (void)n;
  return false;
#endif
}

bool uploadSessionJson(uint32_t clientSeq, const String& json) {
#if ENABLE_CLOUD
  if (!UploadQueue::enqueueJson(clientSeq, json)) return false;
  kickUpload();
  return true;
#else
  (void)clientSeq; (void)json;
  return false;
#endif
}

void kickUpload() {
#if ENABLE_CLOUD
  s_uploadSoon = true;
#endif
}

bool fetchConfig(DeviceConfig& cfg) {
#if ENABLE_CLOUD
  if (!online()) return false;
  String resp;
  int code = httpRequest("GET", s_baseUrl + "/ingest/config?deviceId=" + Storage::deviceId(),
                         "", resp);
  if (code != 200) return false;

  Storage::setPaired(jBool(resp, "paired", Storage::paired()));
  // Overlay only the app-managed fields; device-local settings are untouched.
  cfg.showTimer        = jBool(resp, "showTimer", cfg.showTimer);
  cfg.hapticsEnabled   = jBool(resp, "hapticsEnabled", cfg.hapticsEnabled);
  cfg.adaptiveCoaching = jBool(resp, "adaptiveCoaching", cfg.adaptiveCoaching);
  cfg.nudgesEnabled    = jBool(resp, "nudgesEnabled", cfg.nudgesEnabled);
  cfg.quietStartMin    = (uint16_t)jInt(resp, "quietStartMin", cfg.quietStartMin);
  cfg.quietEndMin      = (uint16_t)jInt(resp, "quietEndMin", cfg.quietEndMin);
  cfg.dailyGoalMin     = (uint16_t)jInt(resp, "dailyGoalMin", cfg.dailyGoalMin);
  return true;
#else
  (void)cfg;
  return false;
#endif
}

void publishPairingCode(const char* code) {
#if ENABLE_CLOUD
  if (!online()) return;
  String body = "{\"deviceId\":\"" + Storage::deviceId() + "\",\"code\":\"" + String(code) + "\"}";
  String resp;
  int c = httpRequest("POST", s_baseUrl + "/ingest/pairing", body, resp);
  if (c != 200)
    Serial.printf("[cloud] pairing publish failed (%d): %s\n", c, resp.c_str());
#else
  (void)code;
#endif
}

#if ENABLE_WIFI
static String readSerialLine(const char* prompt) {
  Serial.print(prompt);
  while (Serial.available()) Serial.read();   // flush
  String s = "";
  uint32_t deadline = millis() + 60000;
  while ((int32_t)(millis() - deadline) < 0) {
    if (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') { if (s.length()) break; else continue; }
      s += c;
    }
  }
  s.trim();
  Serial.println(s);
  return s;
}
#endif

void provisionFromSerial() {
#if ENABLE_WIFI
  Serial.println("\n=== Wi-Fi / cloud provisioning ===");
  Serial.println("Set the Serial Monitor line ending to Newline, then enter:");
  String ssid = readSerialLine("Wi-Fi SSID            : ");
  String pass = readSerialLine("Wi-Fi password        : ");
  String url  = readSerialLine("App base URL          : ");   // e.g. http://192.168.1.50:8080
  String sec  = readSerialLine("Device secret         : ");   // == server DEVICE_INGEST_SECRET

  if (ssid.length()) Storage::setWifiSsid(ssid);
  Storage::setWifiPass(pass);
  if (url.length())  Storage::setAppBaseUrl(url);
  if (sec.length())  Storage::setDeviceSecret(sec);

  loadCreds();
  s_ntpStarted = false;
#if ENABLE_CLOUD
  s_uploadAuthFail = false;
  s_uploadSoon = true;
#endif
  WiFi.disconnect();
  if (s_ssid.length()) WiFi.begin(s_ssid.c_str(), s_pass.c_str());
  Serial.println("Saved. Connecting to Wi-Fi...");
#else
  Serial.println("[cloud] ENABLE_WIFI is 0 — provisioning unavailable.");
#endif
}

} // namespace Cloud
