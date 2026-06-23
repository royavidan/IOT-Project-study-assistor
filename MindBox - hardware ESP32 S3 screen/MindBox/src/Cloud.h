#pragma once
// ============================================================================
// Cloud — Wi-Fi + companion-app link, run on a CORE-0 FreeRTOS task so HTTP
// never blocks the render/timer loop (no in-session stutter). The loop talks to
// the task only through the thread-safe shims below.
//   POST /ingest/telemetry   live device snapshot
//   POST /ingest/sessions    completed sessions (drained from LittleFS queue)
//   POST /ingest/pairing     publish the 6-digit claim code
//   POST /ingest/unpair      release this box's account link (box-side sign-out)
//   GET  /ingest/config      pull settings (the site->box DOWNLINK)
// ============================================================================
#include "types.h"
#include <time.h>

namespace Cloud {
  void begin();                 // load creds, start Wi-Fi, spawn the net task

  // --- loop-side, thread-safe shims -----------------------------------------
  void publishState(const TelemetrySnap& s);    // loop -> task: live mirror data
  void flagTransition();                         // loop -> task: push telemetry now
  void requestConfigSync();                      // loop -> task: pull /ingest/config now
  bool takeSettings(CloudSettings& out);         // task -> loop: new downlinked settings?
  bool nextCommand(RemoteCmd& cmd);              // task -> loop: pop a remote command

  bool   online();              // cached Wi-Fi LINK state (associated + has IP)
  int    wifiRssi();            // cached RSSI
  bool   serverReachable();     // backend actually answered the last HTTP attempt
  int    lastHttpStatus();      // last HTTP code (>0) or transport error (<=0)
  bool   haveClock();           // NTP synced (a proxy for "internet reachable")
  time_t nowEpoch();            // 0 until NTP
  String ssid();                // connected network SSID ("" if offline), for Device info
  String ipString();            // local IP as text ("" if offline)

  // On-device Wi-Fi setup: scan nearby 2.4 GHz networks + save chosen creds.
  void requestScan();           // loop -> task: start an async scan
  bool scanBusy();              // scan in progress (results not ready yet)
  int  scanCount();             // number of networks found (0 while busy)
  bool scanResult(int i, char* ssidOut, size_t n, int& rssi, bool& secured);
  void saveWifi(const String& ssid, const String& pass);  // store creds + reconnect

  // Completed session -> durable LittleFS queue; the task drains it.
  bool uploadSession(const SessionRecord& r, const Sample* samples, int n);
  bool uploadSessionJson(uint32_t clientSeq, const String& json);
  void kickUpload();
  int  pendingCount();          // queued (un-uploaded) sessions, for UI

  void publishPairingCode(const char* code);     // non-blocking: task POSTs it
  void requestUnpair();                          // non-blocking: task POSTs /ingest/unpair
  void provisionFromSerial();                    // 'w' setup (loop; flags creds dirty)

  // On-box Wi-Fi setup: the net task hosts a SoftAP + captive page so a phone can
  // pick a network/password (no laptop). Saved creds flow through the normal reconnect.
  void        startWifiPortal();                 // loop -> task: raise the portal
  void        stopWifiPortal();                  // loop -> task: tear it down
  bool        portalActive();                    // cached: portal currently up?
  const char* portalApName();                    // SoftAP SSID, for the OLED screen
  const char* portalIp();                        // "192.168.4.1", for the OLED screen
}
