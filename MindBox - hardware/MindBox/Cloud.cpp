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
#include <WebServer.h>
#include <DNSServer.h>
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

// Sessions finished while the box had no clock were queued with epoch-0
// ("1970-01-01T00:00:00Z") timestamps. The server accepts them but files them
// under 1970, so they vanish from the app's "today"/recent views. Once NTP is up,
// stamp them with real time (ended = now, started = now - actualFocusSec) before
// upload so they land on the correct day. Inaccurate only by the reconnect delay.
static void patchOfflineTimestamps(String& json) {
  if (time(nullptr) <= 1700000000L) return;          // no clock yet — leave as-is
  static const char* PLACE = "1970-01-01T00:00:00Z";
  if (json.indexOf(PLACE) < 0) return;               // already has real timestamps
  long focusSec = jInt(json, "actualFocusSec", 0);
  time_t nowE = time(nullptr);
  String endIso   = Payload::isoFromEpoch(nowE);
  String startIso = Payload::isoFromEpoch(nowE - (focusSec > 0 ? focusSec : 0));
  json.replace(String("\"endedAt\":\"")   + PLACE + "\"", String("\"endedAt\":\"")   + endIso   + "\"");
  json.replace(String("\"startedAt\":\"") + PLACE + "\"", String("\"startedAt\":\"") + startIso + "\"");
  Serial.printf("[cloud] stamped offline session -> %s\n", endIso.c_str());
}

static void drainUploadQueue() {
  if (s_uploadAuthFail) return;
  if (!s_cachedOnline || UploadQueue::pendingCount() == 0) return;
  if (!s_uploadSoon && millis() - s_lastUploadTry < s_uploadBackoffMs) return;

  s_lastUploadTry = millis();
  String json;
  if (!UploadQueue::readOldest(json)) return;     // FS read (mutex'd internally)
  patchOfflineTimestamps(json);                   // give 1970 sessions a real date

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

// ===========================================================================
// On-box Wi-Fi setup portal (SoftAP + captive page). Runs entirely on this net
// task so every Wi-Fi call stays on core 0. Saved creds flow out through the
// normal s_credsDirty -> manageWifi() reconnect path (no separate connect logic).
// ===========================================================================
static WebServer     s_web(80);
static DNSServer     s_dns;
static bool          s_portalActive    = false;
static volatile bool s_portalReq       = false;  // loop -> task: raise portal
static volatile bool s_portalStopReq   = false;  // loop -> task: tear down now
static uint32_t      s_portalStopAt    = 0;       // deferred stop after Save (0 = none)
static uint32_t      s_portalStartedAt = 0;
static String        s_portalIpStr     = "192.168.4.1";

static const char PORTAL_HTML_HEAD[] PROGMEM =
  "<!DOCTYPE html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
  "<title>MindBox Wi-Fi</title><style>body{font-family:sans-serif;margin:24px;max-width:420px}"
  "h2{margin:0 0 16px}label{display:block;margin:12px 0 4px;font-size:14px}"
  "input,select{width:100%;padding:8px;font-size:16px;box-sizing:border-box}"
  "button{margin-top:18px;padding:12px;width:100%;font-size:16px;background:#2563eb;color:#fff;border:0;border-radius:6px}"
  "</style></head><body><h2>MindBox Wi-Fi setup</h2><form method=POST action=/save>";

// Escape a scanned SSID before putting it into an HTML attribute. Hotspot names
// routinely contain an apostrophe ("John's iPhone") which would otherwise break
// the markup (and the submitted value).
static String htmlAttr(const String& s) {
  String o; o.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    switch (c) {
      case '&':  o += "&amp;";  break;
      case '"':  o += "&quot;"; break;
      case '\'': o += "&#39;";  break;
      case '<':  o += "&lt;";   break;
      case '>':  o += "&gt;";   break;
      default:   o += c;
    }
  }
  return o;
}

static void handlePortalRoot() {
  String page = FPSTR(PORTAL_HTML_HEAD);
  // Editable combo: pick a scanned network OR type one (e.g. a phone hotspot that
  // isn't broadcasting while this phone is on the setup AP, or a hidden SSID).
  page += "<label>Network</label>";
  page += "<input name=ssid list=nets autocomplete=off placeholder='Pick, or type a hotspot name'>";
  page += "<datalist id=nets>";
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    String ss = WiFi.SSID(i);
    if (!ss.length()) continue;
    String esc = htmlAttr(ss);
    page += "<option value=\"" + esc + "\" label=\"" + esc + " (" + String(WiFi.RSSI(i)) + "dBm)\">";
  }
  WiFi.scanDelete();
  page += "</datalist>";
  page += "<label>Password</label><input name=pass type=password placeholder='Wi-Fi password'>";
  page += "<label>Server URL (optional)</label><input name=url value='" + Storage::appBaseUrl() + "'>";
  page += "<button type=submit>Save &amp; connect</button></form></body></html>";
  s_web.send(200, "text/html", page);
}

static void handlePortalSave() {
  String ssid = s_web.arg("ssid");
  String pass = s_web.arg("pass");
  String url  = s_web.arg("url");
  if (ssid.length()) Storage::setWifiSsid(ssid);
  Storage::setWifiPass(pass);
  if (url.length())  Storage::setAppBaseUrl(url);
  String body = "<!DOCTYPE html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
                "<title>MindBox</title></head><body style='font-family:sans-serif;margin:24px'>"
                "<h2>Saved &mdash; reconnecting&hellip;</h2><p>The MindBox is joining <b>" + ssid +
                "</b>. You can close this page.</p></body></html>";
  s_web.send(200, "text/html", body);
  s_portalStopAt = millis() + 1500;   // let the response flush, then tear down + reconnect
  Serial.printf("[portal] creds saved for SSID '%s'\n", ssid.c_str());
}

static void handlePortalRedirect() {
  // Captive detection: bounce every other path to the root so phones pop the portal.
  s_web.sendHeader("Location", String("http://") + s_portalIpStr + "/", true);
  s_web.send(302, "text/plain", "");
}

static void startPortal() {
  WiFi.mode(WIFI_AP_STA);              // AP_STA so we can still scan nearby networks
  WiFi.softAP(WIFI_AP_SSID);
  IPAddress ip = WiFi.softAPIP();
  s_portalIpStr = ip.toString();
  s_dns.start(53, "*", ip);            // wildcard DNS -> captive
  s_web.on("/", handlePortalRoot);
  s_web.on("/save", HTTP_POST, handlePortalSave);
  s_web.onNotFound(handlePortalRedirect);
  s_web.begin();
  s_portalActive    = true;
  s_cachedOnline    = false;
  s_portalStartedAt = millis();
  s_portalStopAt    = 0;
  Serial.printf("[portal] up: join '%s', open http://%s/\n", WIFI_AP_SSID, s_portalIpStr.c_str());
}

static void stopPortal() {
  s_web.stop();
  s_dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  s_portalActive = false;
  s_credsDirty   = true;               // net task reloads creds + reconnects
  Serial.println("[portal] down -> reconnecting STA");
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

    // Wi-Fi setup portal takes over the radio while up: serve the page, skip all
    // STA reconnect / telemetry / upload so AP and STA logic never fight.
    if (s_portalReq && !s_portalActive) { s_portalReq = false; startPortal(); }
    if (s_portalActive) {
      s_dns.processNextRequest();
      s_web.handleClient();
      bool timedOut = millis() - s_portalStartedAt > PORTAL_TIMEOUT_MS;
      bool saveDone = s_portalStopAt && (int32_t)(millis() - s_portalStopAt) >= 0;
      if (s_portalStopReq || timedOut || saveDone) { s_portalStopReq = false; stopPortal(); }
      vTaskDelay(pdMS_TO_TICKS(10));   // stay responsive while serving the portal
      continue;
    }

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
  xTaskCreatePinnedToCore(cloudTask, "net", 16384, nullptr, 1, nullptr, 0);
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

void startWifiPortal() {
#if ENABLE_CLOUD
  s_portalReq = true;
#endif
}

void stopWifiPortal() {
#if ENABLE_CLOUD
  s_portalStopReq = true;
#endif
}

bool portalActive() {
#if ENABLE_CLOUD
  return s_portalActive;
#else
  return false;
#endif
}

const char* portalApName() { return WIFI_AP_SSID; }

const char* portalIp() {
#if ENABLE_CLOUD
  return s_portalIpStr.c_str();
#else
  return "192.168.4.1";
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
