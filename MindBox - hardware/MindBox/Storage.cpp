#include "Storage.h"
#include "config.h"
#include <Preferences.h>

static Preferences prefs;

static String makeId() {
  uint64_t mac = ESP.getEfuseMac();
  char b[24];
  snprintf(b, sizeof(b), "mindbox-%04x%08x", (uint16_t)(mac >> 32), (uint32_t)mac);
  return String(b);
}

namespace Storage {

void begin() {
  prefs.begin("mindbox", false);
  if (prefs.getString("devId", "").length() == 0) prefs.putString("devId", makeId());
}

String deviceId()        { return prefs.getString("devId", makeId()); }
int  lastDurationMin()   { return prefs.getInt("lastDur", DUR_DEFAULT_MIN); }
void setLastDuration(int m) { prefs.putInt("lastDur", m); }
uint32_t nextSeq()       { uint32_t s = prefs.getUInt("seq", 0) + 1; prefs.putUInt("seq", s); return s; }

DeviceConfig loadConfig(const DeviceConfig& d) {
  DeviceConfig c = d;
  c.showTimer        = prefs.getBool("showTimer", d.showTimer);
  c.hapticsEnabled   = prefs.getBool("haptics",   d.hapticsEnabled);
  c.adaptiveCoaching = prefs.getBool("adaptive",  d.adaptiveCoaching);
  c.nudgesEnabled    = prefs.getBool("nudges",    d.nudgesEnabled);
  c.dailyGoalMin     = prefs.getUShort("goal",    d.dailyGoalMin);
  return c;
}

void saveConfig(const DeviceConfig& c) {
  prefs.putBool("showTimer", c.showTimer);
  prefs.putBool("haptics",   c.hapticsEnabled);
  prefs.putBool("adaptive",  c.adaptiveCoaching);
  prefs.putBool("nudges",    c.nudgesEnabled);
  prefs.putUShort("goal",    c.dailyGoalMin);
}

void bufferSession(const SessionRecord& r) {
  // Minimal: count buffered sessions; the live path uploads full samples.
  // TODO: serialize r (+ samples) into an NVS ring buffer and replay on
  // reconnect, so offline sessions sync once Wi-Fi returns (Story 4).
  uint16_t c = prefs.getUShort("bufN", 0) + 1;
  prefs.putUShort("bufN", c);
  (void)r;
}

int bufferedCount() { return prefs.getUShort("bufN", 0); }

} // namespace Storage
