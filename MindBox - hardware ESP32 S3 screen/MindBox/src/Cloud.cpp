#include "Cloud.h"
#include "config.h"
#include "Storage.h"
#include "Payload.h"
#include "UploadQueue.h"
#include <ESP.h>
#include "esp_task_wdt.h"
#include "esp_heap_caps.h"

#if ENABLE_WIFI
#include <WiFi.h>
#include <time.h>
#include <esp_sntp.h>     // sntp_set_sync_interval / sntp_restart — stop the periodic re-sync racing HTTP
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
static char          s_ssidCache[33] = {0};   // SSID/IP snapshots written by the net task (core 0) and
static char          s_ipCache[16]   = {0};   // read by the UI getters (core 1). Never call WiFi.* from
                                              // core 1 — a concurrent radio mutation panics (LoadProhibited).
static volatile bool s_credsDirty = false;

// On-device Wi-Fi scan (net task scans; UI loop reads the snapshot). Single
// producer (task) / single consumer (loop); the loop only reads when !s_scanRunning.
struct ScanItem { char ssid[33]; int8_t rssi; bool secured; };
static ScanItem      s_scanList[WIFI_SCAN_MAX];
static volatile int  s_scanN       = 0;
static volatile bool s_scanReq     = false;   // loop -> task: start a scan
static volatile bool s_scanRunning = false;   // task busy (results not ready)

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
static const int HTTP_MAX_BODY = 4096;   // cap on the response body we read; trusted /ingest JSON is tiny

// After a (re)connect, let lwIP settle before the FIRST HTTP request. Starting SNTP (configTime opens a
// UDP socket + async DNS) and opening the first TCP socket in the SAME task pass races the lwip core and
// double-frees a pbuf (panic: "assert failed: pbuf_free ... p->ref > 0"). This quiet gap keeps SNTP/DNS
// setup and the first connect in separate iterations. See manageWifi()/cloudTask().
static const uint32_t FIRST_NET_SETTLE_MS = 500;
static uint32_t       s_firstOnlineMs     = 0;   // millis() of the latest offline->online transition

// Real reachability of the BACKEND (not just the Wi-Fi link). Updated on every
// actual HTTP attempt: a positive code = the server answered (reachable, even if
// 401/404); a non-positive code = connect/timeout (unreachable / port blocked).
static volatile bool s_serverOk       = false;
static volatile int  s_lastHttpStatus = 0;

// Persistent keep-alive HTTP connection. ONE HTTPClient + WiFiClient reused across all /ingest/* requests
// (they all hit the same host:port = s_baseUrl) instead of constructing and tearing down a fresh socket per
// call. TCP teardown is exactly where the arduino-esp32 lwip pbuf double-free ("pbuf_free p->ref > 0") lives,
// so setReuse(true) — which keeps the socket open between requests — collapses the connect/teardown churn
// (~2 sockets/min) to near-zero and stops TIME_WAIT/PCB accumulation. Persisting the WiFiClient is the key
// part: a stack-local client's destructor would close the socket every call, defeating reuse.
static HTTPClient s_http;
static WiFiClient s_plain;
static bool       s_httpReuseInit = false;

// ---- HTTP core. Returns status (>0) or negative error. Connect/total timeouts
// are capped and a failure suspends all HTTP briefly so an unreachable server
// can't stall the task in a tight retry loop. ------------------------------
static int httpRequest(const char* method, const String& url,
                       const String& body, String& respBody) {
  if (s_baseUrl.length() == 0 || s_secret.length() == 0) return -1;
  if ((int32_t)(millis() - s_netSuspendUntil) < 0) return -99;
  if (!s_httpReuseInit) { s_http.setReuse(true); s_httpReuseInit = true; }
  bool https = url.startsWith("https:");
  bool ok;
#if CLOUD_USE_TLS
  // TLS path stays per-call (TLS is off by default; a persistent secure socket would dangle on the
  // stack-local WiFiClientSecure between calls). The plain path below uses the shared keep-alive client.
  HTTPClient tlsHttp; WiFiClientSecure secure;
  HTTPClient* hp;
  if (https) { secure.setInsecure(); ok = tlsHttp.begin(secure, url); hp = &tlsHttp; }
  else       { ok = s_http.begin(s_plain, url); hp = &s_http; }
#else
  if (https) { Serial.println("[cloud] https URL needs CLOUD_USE_TLS=1 in config.h"); return -3; }
  ok = s_http.begin(s_plain, url);
  HTTPClient* hp = &s_http;
#endif
  if (!ok) return -2;
  HTTPClient& http = *hp;
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("content-type", "application/json");
  http.addHeader("x-device-secret", s_secret);
  int code = (strcmp(method, "POST") == 0) ? http.POST(body) : http.GET();
  s_lastHttpStatus = code;
  if (code > 0) {
    // Bound the body read: the /ingest responses are small trusted JSON. An unbounded getString() on a
    // slow or large body would stretch this call toward the 15s task-WDT and spike heap on the 16KB net
    // task (a likely OOM-panic source given the low free heap). getSize() is Content-Length, or -1 when
    // unknown/chunked (the read timeout still bounds that case).
    respBody = (http.getSize() <= HTTP_MAX_BODY) ? http.getString() : String();
    s_netSuspendUntil = 0; s_serverOk = true;
  } else {
    s_netSuspendUntil = millis() + NET_FAIL_BACKOFF_MS; s_serverOk = false;
  }
  // With setReuse(true) on the plain client, end() drains the body but keeps the TCP socket open for the
  // next same-host request (no FIN/teardown — so no pbuf-free for the next pass to double). A negative code
  // path leaves a dead socket; the next begin() reconnects.
  http.end();
  // Feed the task watchdog around EVERY HTTP call. cloudTask() feeds it once per loop iteration, but one
  // iteration can fire up to four back-to-back blocking requests (pair/telemetry/config/upload); on a slow
  // server 4x~4.5s exceeds the 15s WDT -> panic. Resetting here keeps any burst of calls safe.
  esp_task_wdt_reset();
  // Give lwIP a beat to finish any pbuf housekeeping from this request before the next socket op on the
  // net task — shrinks the residual double-free window. Cheap: this is the net task, not the UI loop.
  vTaskDelay(pdMS_TO_TICKS(20));
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
  if (code != 200) {
    // Don't fail silently — "no server" was undiagnosable without this. Prints the code AND the exact
    // URL the box is dialing (catches a stale NVS IP). -1=refused -11=timeout -99=in back-off
    // 401=secret mismatch 404=wrong route. Rate-limited so it doesn't spam.
    static uint32_t s_lastSyncLog = 0;
    if (millis() - s_lastSyncLog > 5000) {
      s_lastSyncLog = millis();
      Serial.printf("[cloud] config sync failed (%d) url=%s\n", code, s_baseUrl.c_str());
    }
    return;
  }
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
  // Editable combo: pick a scanned 2.4 GHz network OR type one (e.g. a phone
  // hotspot, which can't broadcast while this phone is on the setup AP, or a
  // hidden SSID). IMPORTANT: never call the blocking WiFi.scanNetworks() here —
  // this handler runs on the watchdog-fed net task, so a foreground scan trips
  // the task WDT (panic reboot) and yanks the SoftAP off-channel, dropping the
  // phone. Render from the async-scan snapshot taken before the portal rose.
  page += "<label>Network (2.4 GHz)</label>";
  page += "<input name=ssid list=nets autocomplete=off placeholder='Pick, or type a hotspot name'>";
  page += "<datalist id=nets>";
  for (int i = 0; i < s_scanN; i++) {
    if (!s_scanList[i].ssid[0]) continue;
    page += "<option value=\"" + htmlAttr(s_scanList[i].ssid) + "\">";
  }
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
  WiFi.scanDelete();                   // drop any in-flight on-device scan: the portal
  s_scanRunning = false;               // loop skips scan-harvest, so it would otherwise
  s_scanReq     = false;               // latch scanBusy() true forever after the portal
  WiFi.mode(WIFI_AP_STA);              // AP_STA so the cached scan list stays usable
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
  if (conn) {   // snapshot SSID/IP here (core 0) so the UI getters never call WiFi.* on core 1
    WiFi.SSID().toCharArray(s_ssidCache, sizeof(s_ssidCache));
    WiFi.localIP().toString().toCharArray(s_ipCache, sizeof(s_ipCache));
  } else { s_ssidCache[0] = 0; s_ipCache[0] = 0; }
  if (!conn) { s_serverOk = false; s_lastHttpStatus = 0; }   // no link -> backend definitely unreachable
  if (!conn) {
    s_firstOnlineMs = millis();   // keep the settle gate fresh so the FIRST request after a (re)connect
                                  // waits 500ms and can't share a task pass with the netif rebuild
    if (s_ssid.length() && millis() - s_lastWifiTry > WIFI_RETRY_MS) {
      s_lastWifiTry = millis();
      WiFi.begin(s_ssid.c_str(), s_pass.c_str());
    }
  } else {
    if (!s_ntpStarted) {
      configTime(0, 0, NTP_SERVER);              // keep the system clock in UTC...
      setenv("TZ", TIMEZONE_TZ, 1); tzset();     // ...but make localtime_r() return local time (also fixes quiet hours)
      // Cap the SNTP poll to 12h. At the default (~1h, and FAR more often when pool.ntp.org is
      // unreachable on a LAN) the background re-sync reopens a DNS/UDP socket on the tcpip thread while
      // the net task is mid-HTTP -> the lwip pbuf double-free panic. 12h drift is seconds, irrelevant here.
      sntp_set_sync_interval(12UL * 60 * 60 * 1000);
      sntp_restart();   // apply the new interval now, not after the old one elapses
      s_ntpStarted = true;
    }
    if (!s_wasOnline) {
      s_firstOnlineMs = millis();   // gate the first HTTP burst (below) so it doesn't race SNTP startup
      s_uploadBackoffMs = UPLOAD_RETRY_MIN_MS;
      s_uploadSoon = true;
      s_configNow = true;    // learn paired state + settings without waiting 60 s
      Serial.printf("[net] online: free internal=%u largest=%u\n",   // headroom AFTER Wi-Fi's ~45KB
                    (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                    (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));
    }
  }
  s_wasOnline = conn;
}

static void cloudTask(void*) {
  esp_task_wdt_add(nullptr);
  // Bring the radio up HERE (core 0) — not in Cloud::begin(), which runs in setup() on core 1. Touching
  // WiFi.* on core 1 and then driving the stack from this task opens a cross-core association window that
  // can corrupt lwip pbufs. Keeping every WiFi.* call on this one task removes that window.
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_TX_POWER);     // soften the association current spike (brownout mitigation)
  // Modem sleep OFF by default (WIFI_MODEM_SLEEP=0): power-save naps drop packets / sleep mid-handshake,
  // stalling periodic HTTP long enough to trip the task watchdog. Always-on keeps the link solid.
  WiFi.setSleep(WIFI_MODEM_SLEEP ? WIFI_PS_MIN_MODEM : WIFI_PS_NONE);
  // NB: deliberately NOT WiFi.setAutoReconnect(true). Auto-reconnect runs in the arduino-esp32 Wi-Fi EVENT
  // task, which would re-associate / rebuild the netif concurrently with this net task's in-flight HTTP
  // socket -> a cross-actor lwip pbuf double-free window. Reconnection is instead serialized onto THIS task:
  // manageWifi() re-begins every WIFI_RETRY_MS while the link is down. Keeps 100% of socket lifecycle here.
  if (s_ssid.length()) WiFi.begin(s_ssid.c_str(), s_pass.c_str());
  uint32_t lastTele = 0, lastSync = 0;
  for (;;) {
    esp_task_wdt_reset();

    // Heap trend (rate-limited ~30s): if free heap drifts down over minutes while connected, a per-request
    // socket/TIME_WAIT leak is also in play; flat heap means the reboots are purely the network stall.
    static uint32_t s_lastHeapLog = 0;
    if (millis() - s_lastHeapLog > 30000) {
      s_lastHeapLog = millis();
      Serial.printf("[net] heap free=%u internal=%u\n",
                    (unsigned)ESP.getFreeHeap(),
                    (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    }

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

    // On-device Wi-Fi scan (async): kick on request, harvest when complete.
    if (s_scanReq && !s_scanRunning) {
      s_scanReq = false;
      WiFi.scanDelete();
      // Free the radio first. A pending STA association attempt — e.g. to the stale
      // default creds ("sen1" from SECRETS.h) when that AP isn't in range — makes
      // scanNetworks() come back with ZERO networks on the S3. If we're not actually
      // connected, drop the attempt for the scan; the chosen network is (re)joined
      // later via saveWifi(). Ensure STA mode, then active-scan all 2.4 GHz channels
      // with a 300 ms/channel dwell so weaker / distant APs still show up.
      if (!(WiFi.getMode() & WIFI_MODE_STA)) WiFi.mode(WIFI_STA);
      if (WiFi.status() != WL_CONNECTED)     WiFi.disconnect(false, false);
      WiFi.scanNetworks(true /*async*/, false /*hidden*/, false /*passive*/, 300 /*ms/chan*/);
      s_scanRunning = true;
    }
    if (s_scanRunning) {
      int r = WiFi.scanComplete();
      if (r >= 0) {
        int n = 0;
        for (int i = 0; i < r && n < WIFI_SCAN_MAX; i++) {
          String ss = WiFi.SSID(i);
          if (!ss.length()) continue;
          bool dup = false;
          for (int j = 0; j < n; j++) if (ss == s_scanList[j].ssid) { dup = true; break; }
          if (dup) continue;
          strncpy(s_scanList[n].ssid, ss.c_str(), 32); s_scanList[n].ssid[32] = 0;
          s_scanList[n].rssi    = (int8_t)WiFi.RSSI(i);
          s_scanList[n].secured = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
          n++;
        }
        for (int a = 1; a < n; a++) {     // sort by signal, strongest first
          ScanItem t = s_scanList[a]; int b = a - 1;
          while (b >= 0 && s_scanList[b].rssi < t.rssi) { s_scanList[b + 1] = s_scanList[b]; b--; }
          s_scanList[b + 1] = t;
        }
        s_scanN = n;
        WiFi.scanDelete();
        s_scanRunning = false;          // set last: loop now safe to read snapshot
      } else if (r == WIFI_SCAN_FAILED) {
        s_scanN = 0; s_scanRunning = false;
      }
    }

    manageWifi();
    // Gate the first HTTP burst until lwIP settles after connect (SNTP/DNS started in manageWifi must not
    // share a task pass with the first TCP connect — that double-frees a pbuf and panics).
    //
    // ONE network request per pass (else-if chain): each blocking HTTPClient call can stall ~18-20s if a
    // socket goes half-open (the connect/read timeouts are NOT hard-bounded on arduino-esp32). Firing
    // several back-to-back stacks those worst cases inside one watchdog window -> task-WDT reboot. The WDT
    // is fed at the top of every pass, so spacing them one-per-iteration keeps a single stall survivable
    // and cuts socket churn. The next due request just runs on the following pass (NET_TASK_PERIOD_MS later).
    if (s_cachedOnline && millis() - s_firstOnlineMs > FIRST_NET_SETTLE_MS) {
      if (s_pairPending)        { s_pairPending = false; doPairing(); }
      // Unpair BEFORE the config fetch so the server releases ownership and the next downlink can't
      // re-report paired:true. Retry until it lands (clear the flag only on success).
      else if (s_unpairPending) { if (doUnpair()) s_unpairPending = false; }
      // A transition POST (s_pushNow) is honored only once per TELEMETRY_MIN_GAP_MS, so a rapid
      // pause->resume->skip burst collapses to one POST instead of several back-to-back sockets (each an
      // lwip double-free window). If gated, s_pushNow stays set and fires on a later pass. 60s heartbeat as-is.
      else if ((s_pushNow && millis() - lastTele > TELEMETRY_MIN_GAP_MS)
               || millis() - lastTele > TELEMETRY_PERIOD_MS) {
        s_pushNow = false; lastTele = millis(); pushTelemetry();
      }
      else if (s_configNow || millis() - lastSync > CONFIG_FETCH_MS) {
        s_configNow = false; lastSync = millis(); syncDownlink();
      }
      else drainUploadQueue();
    }
    vTaskDelay(pdMS_TO_TICKS(NET_TASK_PERIOD_MS));
  }
}
#endif // ENABLE_CLOUD

namespace Cloud {

void begin() {
#if ENABLE_WIFI
  loadCreds();
#endif
#if ENABLE_CLOUD
  s_mux = xSemaphoreCreateMutex();
  s_cmdQueue = xQueueCreate(8, sizeof(RemoteCmd));
  // NOTE: the radio is brought up at the top of cloudTask() (core 0), NOT here — Cloud::begin() runs in
  // setup() on core 1, and touching WiFi.* there before handing the stack to the net task races lwip.
  xTaskCreatePinnedToCore(cloudTask, "net", 16384, nullptr, 1, nullptr, 0);
#elif ENABLE_WIFI
  // Wi-Fi without the cloud net task (unusual build): no task to own the radio, so bring it up here.
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_TX_POWER);     // soften the association current spike (brownout mitigation)
  WiFi.setSleep(WIFI_MODEM_SLEEP ? WIFI_PS_MIN_MODEM : WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);
  if (s_ssid.length()) WiFi.begin(s_ssid.c_str(), s_pass.c_str());
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

bool serverReachable() {
#if ENABLE_CLOUD
  return s_serverOk;
#else
  return false;
#endif
}
int lastHttpStatus() {
#if ENABLE_CLOUD
  return s_lastHttpStatus;
#else
  return 0;
#endif
}

String ssid() {
#if ENABLE_WIFI
  return String(s_ssidCache);     // cached snapshot from the net task — no cross-core WiFi.* call
#else
  return String();
#endif
}

String ipString() {
#if ENABLE_WIFI
  return String(s_ipCache);       // cached snapshot from the net task — no cross-core WiFi.* call
#else
  return String();
#endif
}

// --- on-device Wi-Fi scan + save (used by the touchscreen setup flow) -------
void requestScan() {
#if ENABLE_WIFI
  s_scanReq = true;
#endif
}
bool scanBusy()  {
#if ENABLE_WIFI
  return s_scanRunning || s_scanReq;
#else
  return false;
#endif
}
int  scanCount() {
#if ENABLE_WIFI
  return s_scanRunning ? 0 : s_scanN;
#else
  return 0;
#endif
}
bool scanResult(int i, char* out, size_t n, int& rssi, bool& secured) {
#if ENABLE_WIFI
  if (s_scanRunning || i < 0 || i >= s_scanN || !out || n == 0) return false;
  strncpy(out, s_scanList[i].ssid, n - 1); out[n - 1] = 0;
  rssi = s_scanList[i].rssi; secured = s_scanList[i].secured;
  return true;
#else
  (void)i; (void)out; (void)n; (void)rssi; (void)secured; return false;
#endif
}
void saveWifi(const String& ssid, const String& pass) {
#if ENABLE_WIFI
  Storage::setWifiSsid(ssid);
  Storage::setWifiPass(pass);
  s_credsDirty = true;   // net task reloads creds + reconnects (same path as the portal)
#else
  (void)ssid; (void)pass;
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

// "HH:MM" local time into buf when the clock is synced; empty + false otherwise (caller hides the clock).
bool localTimeHHMM(char* buf, size_t n) {
  if (!buf || n == 0) return false;
  buf[0] = 0;
  if (!haveClock()) return false;
  time_t ep = nowEpoch();
  struct tm lt;
  localtime_r(&ep, &lt);                 // local thanks to the TZ set at SNTP init
  snprintf(buf, n, "%02d:%02d", lt.tm_hour, lt.tm_min);
  return true;
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
  Serial.println("(Tip: you can also set Wi-Fi on the box itself — Device > Wi-Fi Setup.)");
  // Show what's actually in NVS first — it overrides SECRETS.h, so a stale URL here (e.g. an old
  // laptop IP) is the usual reason "it worked before" stops working. Blank entries below keep each.
  Serial.println("Current stored config (NVS overrides SECRETS.h):");
  Serial.printf ("  Wi-Fi SSID : %s\n", Storage::wifiSsid().c_str());
  Serial.printf ("  App URL    : %s\n", Storage::appBaseUrl().c_str());
  Serial.printf ("  Secret     : %s\n", Storage::deviceSecret().length() ? "set" : "(none)");
  Serial.printf ("  Device id  : %s\n", Storage::deviceId().c_str());
  Serial.println("Set the Serial Monitor line ending to Newline, then enter (blank = keep current):");
  String ssid = readSerialLine("Wi-Fi SSID            : ");
  String pass = readSerialLine("Wi-Fi password        : ");
  String url  = readSerialLine("App base URL          : ");   // e.g. http://192.168.1.50:8080
  String sec  = readSerialLine("Device secret         : ");   // == server DEVICE_INGEST_SECRET

  if (ssid.length()) Storage::setWifiSsid(ssid);
  if (pass.length()) Storage::setWifiPass(pass);   // blank = keep current (was unconditional — wiped the pw!)
  if (url.length())  Storage::setAppBaseUrl(url);
  if (sec.length())  Storage::setDeviceSecret(sec);

  s_credsDirty = true;   // the net task reloads creds + reconnects
  Serial.println("Saved. The network task will reconnect shortly.");
#else
  Serial.println("[cloud] ENABLE_WIFI is 0 — provisioning unavailable.");
#endif
}

} // namespace Cloud
