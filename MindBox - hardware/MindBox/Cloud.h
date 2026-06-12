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
  bool takeSettings(CloudSettings& out);         // task -> loop: new downlinked settings?
  bool nextCommand(RemoteCmd& cmd);              // task -> loop: pop a remote command

  bool   online();              // cached Wi-Fi state (task-updated)
  int    wifiRssi();            // cached RSSI
  bool   haveClock();           // NTP synced
  time_t nowEpoch();            // 0 until NTP

  // Completed session -> durable LittleFS queue; the task drains it.
  bool uploadSession(const SessionRecord& r, const Sample* samples, int n);
  bool uploadSessionJson(uint32_t clientSeq, const String& json);
  void kickUpload();
  int  pendingCount();          // queued (un-uploaded) sessions, for UI

  void publishPairingCode(const char* code);     // non-blocking: task POSTs it
  void requestUnpair();                          // non-blocking: task POSTs /ingest/unpair
  void provisionFromSerial();                    // 'w' setup (loop; flags creds dirty)
}
