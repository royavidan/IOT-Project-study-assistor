#pragma once
// ============================================================================
// Storage — non-volatile state (ESP32 NVS via Preferences). Survives power
// cycles (Story 4): device id, work/break durations, sequence counter, the
// downlinked DeviceConfig, and an offline session log.
// ============================================================================
#include "types.h"

namespace Storage {
  void begin();
  String deviceId();

  int  workDurationMin();
  int  breakDurationMin();
  void setWorkDuration(int m);
  void setBreakDuration(int m);

  int  cycleCount();
  void setCycleCount(int n);

  uint32_t nextSeq();

  DeviceConfig loadConfig(const DeviceConfig& def);
  void saveConfig(const DeviceConfig& c);

  bool paired();
  void setPaired(bool p);

  // Provisioning (entered over serial, persisted in NVS).
  String wifiSsid();     void setWifiSsid(const String& s);
  String wifiPass();     void setWifiPass(const String& s);
  String appBaseUrl();   void setAppBaseUrl(const String& s);
  String deviceSecret(); void setDeviceSecret(const String& s);

  void saveSessionLog(const SessionRecord& r);
  SessionLogEntry lastSessionLog();
  bool            sessionLogAt(int index, SessionLogEntry& out); // 0 = newest
  uint32_t        totalFocusSec();
  int             sessionLogCount();
  void            recordSetComplete();
  int             todaySetsCount();

  void saveCheckpoint(const SessionCheckpoint& cp);
  bool loadCheckpoint(SessionCheckpoint& cp);
  void clearCheckpoint();
  bool hasCheckpoint();

  bool bufferSession(const SessionRecord& r);   // returns true if daily goal hit

  void     setLiveFocusSec(uint32_t sec);
  uint32_t todayFocusSec();       // persisted completed WORK focus today
  uint32_t todayDisplaySec();     // persisted + live in-progress WORK
  int      todayFocusCount();
  void     resetToday();
  void     syncDayBoundary();

  int  bufferedCount();

  // Upload-queue overflow flag (single NVS namespace — do not open a second Preferences).
  bool uploadQueueDropped();
  void setUploadQueueDropped(bool v);
  void clearUploadQueueDropped();

  // Per-desk sensor calibration (NVS; adjust over serial — Diagnostics 'c' command).
  float noiseFullScale();
  void  setNoiseFullScale(float v);
  float lightLuxScale();
  void  setLightLuxScale(float v);
  float lightVarScale();
  void  setLightVarScale(float v);
  float tempOffsetC();
  void  setTempOffsetC(float v);
  void  resetSensorCalibration();
}
