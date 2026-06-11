#pragma once
// ============================================================================
// Storage — non-volatile state (ESP32 NVS via Preferences). Survives power
// cycles (Story 4): device id, last-used duration, sequence counter, the
// downlinked DeviceConfig, and an offline session buffer.
// ============================================================================
#include "types.h"

namespace Storage {
  void begin();
  String deviceId();                 // stable id (from MAC on first boot)

  int  lastDurationMin();
  void setLastDuration(int m);
  uint32_t nextSeq();                // monotonic clientSeq for uploads

  DeviceConfig loadConfig(const DeviceConfig& def);
  void saveConfig(const DeviceConfig& c);

  void bufferSession(const SessionRecord& r);   // offline buffer (Story 4)
  int  bufferedCount();
}
