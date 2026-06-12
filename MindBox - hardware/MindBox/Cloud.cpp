#include "Cloud.h"
#include "config.h"
#include "Storage.h"
#include "Payload.h"
#include "UploadQueue.h"
#include <ESP.h>
#include "esp_task_wdt.h"

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

// ===========================================================================
// Credentials + cached link state. Creds are owned by the net task; the loop
// only writes NVS + flips s_credsDirty (provisioning), never the live strings.
// ===========================================================================
#if ENABLE_WIFI
static String        s_ssid, s_pass, s_baseUrl, s_secret, s_deviceId;
static bool          s_ntpStarted = false;
static uint32_t      s_lastWifiTry = 0;
static volatile bool s_cachedOnline = false;
static volatile int  s_rssi = 0;
static volatile bool s_credsDirty = false;

static void loadCreds() {
  s_ssid     = Storage::wifiSsid();
  s_pass     = Storage::wifiPass();
  s_baseUrl  = Storage::appBaseUrl();
  s_secret   = Storage::deviceSecret();
  s_deviceId = Storage::deviceId();
  while (s_baseUrl.endsWith("/")) s_baseUrl.remove(s_baseUrl.length() - 1);
}
#endif

#if ENABLE_CLOUD
// ===========================================================================
// task <-> loop shared state
// ===========================================================================
static SemaphoreHandle_t s_mux = nullptr;       // guards s_snap + s_settings
static QueueHandle_t     s_cmdQueue = nullptr;
static TelemetrySnap     s_snap = {};
static CloudSettings     s_settings = {};
static volatile bool     s_settingsReady = false;
static volatile bool     s_pushNow = false;
static volatile bool     s_configNow = false;
static volatile bool     s_pairPending = false;
static volatile bool     s_unpairPending = false;
static char              s_pairCode[8] = {0};

static uint32_t s_netSuspendUntil = 0;

// ---- HTTP core. Returns status (>0) or negative error. Connect/total timeouts
// are capped and a failure suspends all HTTP briefly so an unreachable server
// can't stall the task in a tight retry loop. ------------------------------
static int httpRequest(const char* method, const String& url,
                       const String& body, String& respBody) {
  if (s_baseUrl.length() == 0 || s_secret.length() == 0) return -1;
  if ((int32_t)(millis() - s_netSuspendUntil) < 0) return -99;
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
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("content-type", "application/json");
  http.addHeader("x-device-secret", s_secret);
  int code = (strcmp(method, "POST") == 0) ? http.POST(body) : http.GET();
  if (code > 0) { respBody = http.getString(); s_netSuspendUntil = 0; }
  else s_netSuspendUntil = millis() + NET_FAIL_BACKOFF_MS;
  http.end();
  return code;
}

// ---- minimal flat-JSON readers for the trusted /ingest/config response ----
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
static void jStr(const String& b, const char* key, char* out, size_t n) {
  if (!out || n == 0) return;
  out[0] = 0;
  int p = valuePos(b, key);
  if (p < 0 || p >= (int)b.length() || b[p] != '"') return;
  p++;
  size_t i = 0;
  while (p < (int)b.length() && b[p] != '"' && i + 1 < n) out[i++] = b[p++];
  out[i] = 0;
}

// ===========================================================================
// upload-drain state + worker (runs on the task)
// ===========================================================================
static bool     s_uploadSoon = false;
static bool     s_uploadAuthFail = false;
static bool     s_wasOnline = false;
static uint32_t s_lastUploadTry = 0;
static uint32_t s_uploadBackoffMs = UPLOAD_RETRY_MIN_MS;

static void drainUploadQueue() {
  if (s_uploadAuthFail) return;
  if (!s_cachedOnline || UploadQueue::pendingCount() == 0) return;
  if (!s_uploadSoon && millis() - s_lastUploadTry < s_uploadBackoffMs) return;

  s_lastUploadTry = millis();
  String json;
  if (!UploadQueue::readOldest(json)) return;     // FS read (mutex'd internally)

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

// ===========================================================================
// net-task workers
// ===========================================================================
static const char* stateStr(uint8_t st, uint8_t mode) {
  switch ((SysState)st) {
    case ST_RUNNING: return mode == MODE_WORK ? "work" : "break";
    case ST_PAUSED:  return "paused";
    default:         return "idle";
  }
}

static void pushTelemetry() {
  TelemetrySnap s;
  xSemaphoreTake(s_mux, portMAX_DELAY); s = s_snap; xSemaphoreGive(s_mux);

  String ts = (time(nullptr) > 1700000000L)
                ? Payload::isoFromEpoch(time(nullptr)) : "1970-01-01T00:00:00Z";
  String body = "{";
  body += "\"deviceId\":\"" + s_deviceId + "\",";
  body += "\"ts\":\"" + ts + "\",";
  body += "\"state\":\""; body += stateStr(s.state, s.mode); body += "\",";
  body += "\"batteryPct\":" + String(s.batteryPct) + ",";
  body += "\"wifiRssi\":" + String(s_rssi) + ",";
  body += "\"sensorHealth\":" + (s.health[0] ? String(s.health) : String("null")) + ",";
  body += "\"firmwareVersion\":\"" FW_VERSION "\"";
  body += "}";
  String resp;
  httpRequest("POST", s_baseUrl + "/ingest/telemetry", body, resp);
}

static void syncDownlink() {
  String resp;
  int code = httpRequest("GET", s_baseUrl + "/ingest/config?deviceId=" + s_deviceId, "", resp);
  if (code != 200) return;
  CloudSettings cs;
  cs.paired           = jBool(resp, "paired", false);
  cs.showTimer        = jBool(resp, "showTimer", true);
  cs.hapticsEnabled   = jBool(resp, "hapticsEnabled", true);
  cs.adaptiveCoaching = jBool(resp, "adaptiveCoaching", false);
  cs.nudgesEnabled    = jBool(resp, "nudgesEnabled", true);
  cs.quietStartMin    = (uint16_t)jInt(resp, "quietStartMin", 0xFFFF);
  cs.quietEndMin      = (uint16_t)jInt(resp, "quietEndMin", 0xFFFF);
  cs.dailyGoalMin     = (uint16_t)jInt(resp, "dailyGoalMin", 180);
  cs.todayFocusSec    = (int32_t)jInt(resp, "todayFocusSec", 0);
  jStr(resp, "ownerDisplayName", cs.ownerDisplayName, sizeof(cs.ownerDisplayName));
  jStr(resp, "ownerEmail", cs.ownerEmail, sizeof(cs.ownerEmail));
  xSemaphoreTake(s_mux, portMAX_DELAY);
  s_settings = cs; s_settingsReady = true;
  xSemaphoreGive(s_mux);
}

static void doPairing() {
  String body = "{\"deviceId\":\"" + s_deviceId + "\",\"code\":\"" + String(s_pairCode) + "\"}";
  String resp;
  int c = httpRequest("POST", s_baseUrl + "/ingest/pairing", body, resp);
  if (c != 200) Serial.printf("[cloud] pairing publish failed (%d): %s\n", c, resp.c_str());
  else s_configNow = true;   // poll soon in case the user claims immediately
}

static bool doUnpair() {
  String body = "{\"deviceId\":\"" + s_deviceId + "\"}";
  String resp;
  int c = httpRequest("POST", s_baseUrl + "/ingest/unpair", body, resp);
  if (c != 200) { Serial.printf("[cloud] unpair failed (%d): %s\n", c, resp.c_str()); return false; }
  Serial.println("[cloud] account released on server");
  return true;
}

static void manageWifi() {
  if (s_credsDirty) {
    s_credsDirty = false;
    loadCreds();
    WiFi.disconnect();
    if (s_ssid.length()) WiFi.begin(s_ssid.c_str(), s_pass.c_str());
    s_ntpStarted = false;
    s_uploadAuthFail = false;
    s_uploadSoon = true;
  }
  bool conn = (WiFi.status() == WL_CONNECTED);
  s_cachedOnline = conn;
  s_rssi = conn ? WiFi.RSSI() : 0;
  if (!conn) {
    if (s_ssid.length() && millis() - s_lastWifiTry > WIFI_RETRY_MS) {
      s_lastWifiTry = millis();
      WiFi.begin(s_ssid.c_str(), s_pass.c_str());
    }
  } else {
    if (!s_ntpStarted) { configTime(0, 0, NTP_SERVER); s_ntpStarted = true; }
    if (!s_wasOnline) {
      s_uploadBackoffMs = UPLOAD_RETRY_MIN_MS;
      s_uploadSoon = true;
      s_configNow = true;    // learn paired state + settings without waiting 60 s
    }
  }
  s_wasOnline = conn;
}

static void cloudTask(void*) {
  esp_task_wdt_add(nullptr);
  uint32_t lastTele = 0, lastSync = 0;
  for (;;) {
    esp_task_wdt_reset();
    manageWifi();
    if (s_cachedOnline) {
      if (s_pairPending)   { s_pairPending = false;   doPairing(); }
      // Unpair BEFORE the config fetch below so the server releases ownership
      // and the same/next downlink can't re-report paired:true. Retry until it
      // lands (only clear the flag on success) so a transient error can't leave
      // the box locally signed out but still linked server-side.
      if (s_unpairPending && doUnpair()) s_unpairPending = false;
      if (s_pushNow || millis() - lastTele > TELEMETRY_PERIOD_MS) {
        s_pushNow = false; lastTele = millis(); pushTelemetry();
      }
      if (s_configNow || millis() - lastSync > CONFIG_FETCH_MS) {
        s_configNow = false;
        lastSync = millis();
        syncDownlink();
      }
      drainUploadQueue();
    }
    vTaskDelay(pdMS_TO_TICKS(NET_TASK_PERIOD_MS));
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
#if ENABLE_CLOUD
  s_mux = xSemaphoreCreateMutex();
  s_cmdQueue = xQueueCreate(8, sizeof(RemoteCmd));
  xTaskCreatePinnedToCore(cloudTask, "net", 10240, nullptr, 1, nullptr, 0);
#endif
}

void publishState(const TelemetrySnap& s) {
#if ENABLE_CLOUD
  if (!s_mux) return;
  xSemaphoreTake(s_mux, portMAX_DELAY); s_snap = s; xSemaphoreGive(s_mux);
#else
  (void)s;
#endif
}

void flagTransition() {
#if ENABLE_CLOUD
  s_pushNow = true;
#endif
}

void requestConfigSync() {
#if ENABLE_CLOUD
  s_configNow = true;
#endif
}

bool takeSettings(CloudSettings& out) {
#if ENABLE_CLOUD
  if (!s_settingsReady || !s_mux) return false;
  xSemaphoreTake(s_mux, portMAX_DELAY);
  out = s_settings; s_settingsReady = false;
  xSemaphoreGive(s_mux);
  return true;
#else
  (void)out; return false;
#endif
}

bool nextCommand(RemoteCmd& cmd) {
#if ENABLE_CLOUD
  if (!s_cmdQueue) return false;
  return xQueueReceive(s_cmdQueue, &cmd, 0) == pdTRUE;
#else
  (void)cmd; return false;
#endif
}

bool online() {
#if ENABLE_WIFI
  return s_cachedOnline;
#else
  return false;
#endif
}

int wifiRssi() {
#if ENABLE_WIFI
  return s_rssi;
#else
  return 0;
#endif
}

bool haveClock() {
#if ENABLE_WIFI
  return time(nullptr) > 1700000000L;
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

bool uploadSession(const SessionRecord& r, const Sample* samples, int n) {
#if ENABLE_CLOUD
  String json = Payload::sessionJson(r, samples, n, s_deviceId.c_str());
  if (!UploadQueue::enqueueJson(r.clientSeq, json)) return false;
  s_uploadSoon = true;
  return true;
#else
  (void)r; (void)samples; (void)n; return false;
#endif
}

bool uploadSessionJson(uint32_t clientSeq, const String& json) {
#if ENABLE_CLOUD
  if (!UploadQueue::enqueueJson(clientSeq, json)) return false;
  s_uploadSoon = true;
  return true;
#else
  (void)clientSeq; (void)json; return false;
#endif
}

void kickUpload() {
#if ENABLE_CLOUD
  s_uploadSoon = true;
#endif
}

int pendingCount() {
#if ENABLE_CLOUD
  return UploadQueue::pendingCount();
#else
  return 0;
#endif
}

void publishPairingCode(const char* code) {
#if ENABLE_CLOUD
  strncpy(s_pairCode, code ? code : "", sizeof(s_pairCode) - 1);
  s_pairCode[sizeof(s_pairCode) - 1] = 0;
  s_pairPending = true;
#else
  (void)code;
#endif
}

void requestUnpair() {
#if ENABLE_CLOUD
  s_unpairPending = true;
#endif
}

#if ENABLE_WIFI
static String readSerialLine(const char* prompt) {
  Serial.print(prompt);
  while (Serial.available()) Serial.read();   // flush
  String s = "";
  uint32_t deadline = millis() + 60000;
  while ((int32_t)(millis() - deadline) < 0) {
    esp_task_wdt_reset();            // keep the watchdog fed during the long wait
    if (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') { if (s.length()) break; else continue; }
      s += c;
    } else {
      delay(1);
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

  s_credsDirty = true;   // the net task reloads creds + reconnects
  Serial.println("Saved. The network task will reconnect shortly.");
#else
  Serial.println("[cloud] ENABLE_WIFI is 0 — provisioning unavailable.");
#endif
}

} // namespace Cloud
