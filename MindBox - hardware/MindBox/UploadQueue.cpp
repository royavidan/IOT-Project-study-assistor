#include "UploadQueue.h"
#include "config.h"
#include "Payload.h"
#include "Storage.h"

#if ENABLE_CLOUD
#include <LittleFS.h>
#endif

#if ENABLE_CLOUD

static bool s_mounted = false;
static int  s_pending = -1;

static const char* UPLOAD_DIR = "/upload";

static int scanPendingCount() {
  if (!s_mounted) return 0;
  if (!LittleFS.exists(UPLOAD_DIR)) return 0;
  int count = 0;
  File root = LittleFS.open(UPLOAD_DIR);
  if (!root || !root.isDirectory()) return 0;
  for (File f = root.openNextFile(); f; f = root.openNextFile()) {
    if (f.isDirectory()) continue;
    const char* name = f.name();
    const char* base = strrchr(name, '/');
    base = base ? base + 1 : name;
    if (strlen(base) == 13 && strcmp(base + 8, ".json") == 0) count++;
  }
  return count;
}

static bool ensureDir() {
  if (!s_mounted) return false;
  if (!LittleFS.exists(UPLOAD_DIR))
    return LittleFS.mkdir(UPLOAD_DIR);
  return true;
}

static bool parseSeqFromName(const char* name, uint32_t& outSeq) {
  if (!name) return false;
  const char* base = strrchr(name, '/');
  base = base ? base + 1 : name;
  if (strlen(base) != 13) return false;
  if (strcmp(base + 8, ".json") != 0) return false;
  char buf[9];
  memcpy(buf, base, 8);
  buf[8] = '\0';
  char* end = nullptr;
  unsigned long v = strtoul(buf, &end, 10);
  if (!end || *end != '\0') return false;
  outSeq = (uint32_t)v;
  return true;
}

static bool scanOldest(uint32_t& outSeq, bool& outFound) {
  outFound = false;
  outSeq = 0;
  if (!ensureDir()) return false;

  File root = LittleFS.open(UPLOAD_DIR);
  if (!root || !root.isDirectory()) return false;

  for (File f = root.openNextFile(); f; f = root.openNextFile()) {
    if (f.isDirectory()) continue;
    uint32_t seq = 0;
    if (!parseSeqFromName(f.name(), seq)) continue;
    if (!outFound || seq < outSeq) {
      outSeq = seq;
      outFound = true;
    }
  }
  return true;
}

static void removeTmpFiles() {
  if (!ensureDir()) return;
  File root = LittleFS.open(UPLOAD_DIR);
  if (!root || !root.isDirectory()) return;
  for (File f = root.openNextFile(); f; f = root.openNextFile()) {
    if (f.isDirectory()) continue;
    const char* name = f.name();
    const char* base = strrchr(name, '/');
    base = base ? base + 1 : name;                 // core 3.x name() = basename
    size_t len = strlen(base);
    if (len > 4 && strcmp(base + len - 4, ".tmp") == 0) {
      char full[40];
      snprintf(full, sizeof(full), "%s/%s", UPLOAD_DIR, base);
      LittleFS.remove(full);                        // remove needs the full path
    }
  }
}

static bool pathForSeq(uint32_t seq, char* path, size_t n, const char* ext) {
  return snprintf(path, n, "%s/%08u.%s", UPLOAD_DIR, seq, ext) > 0;
}

static bool writeSession(uint32_t seq, const String& json) {
  if (!ensureDir()) return false;
  char tmppath[40], path[40];
  pathForSeq(seq, tmppath, sizeof(tmppath), "tmp");
  pathForSeq(seq, path, sizeof(path), "json");

  File f = LittleFS.open(tmppath, "w");
  if (!f) return false;
  size_t written = f.print(json);
  f.close();
  if (written != json.length()) {
    LittleFS.remove(tmppath);
    return false;
  }
  if (LittleFS.exists(path))
    LittleFS.remove(path);
  if (!LittleFS.rename(tmppath, path)) {
    LittleFS.remove(tmppath);
    return false;
  }
  return true;
}

static bool dropOldest() {
  uint32_t seq = 0;
  bool found = false;
  if (!scanOldest(seq, found) || !found) return false;
  char path[40];
  pathForSeq(seq, path, sizeof(path), "json");
  if (!LittleFS.remove(path)) return false;
  if (s_pending > 0) s_pending--;
  Serial.printf("[queue] dropped seq %08u (overflow)\n", seq);
  return true;
}

#endif // ENABLE_CLOUD

namespace UploadQueue {

void begin() {
#if ENABLE_CLOUD
  s_mounted = LittleFS.begin(false);
  if (!s_mounted) {
    Serial.println("[queue] LittleFS formatting (first boot)...");
    s_mounted = LittleFS.begin(true);
  }
  if (!s_mounted) {
    Serial.println("[queue] LittleFS mount failed — check partition scheme");
    return;
  }
  ensureDir();
  removeTmpFiles();
  s_pending = scanPendingCount();
  Serial.printf("[queue] ready pending=%d dropped=%d\n",
                s_pending, hasDropped() ? 1 : 0);
#else
  (void)0;
#endif
}

bool enqueueJson(uint32_t clientSeq, const String& json) {
#if ENABLE_CLOUD
  if (json.length() == 0 || json[0] != '{') return false;
  if (!s_mounted) {
    s_mounted = LittleFS.begin(false);
    if (!s_mounted) s_mounted = LittleFS.begin(true);
    if (!s_mounted) {
      Serial.println("[queue] enqueue failed — FS not mounted");
      return false;
    }
  }
  ensureDir();

  while (pendingCount() >= UPLOAD_QUEUE_MAX) {
    if (!dropOldest()) return false;
    Storage::setUploadQueueDropped(true);
  }

  if (!writeSession(clientSeq, json)) {
    Serial.println("[queue] write failed");
    return false;
  }
  if (s_pending >= 0) s_pending++;
  else s_pending = scanPendingCount();
  Serial.printf("[queue] enqueued seq %08u pending=%d\n", clientSeq, pendingCount());
  return true;
#else
  (void)clientSeq; (void)json;
  return false;
#endif
}

bool enqueue(const SessionRecord& r, const Sample* samples, int n) {
  String json = Payload::sessionJson(r, samples, n, Storage::deviceId().c_str());
  return enqueueJson(r.clientSeq, json);
}

int pendingCount() {
#if ENABLE_CLOUD
  if (!s_mounted) return 0;
  if (s_pending < 0) s_pending = scanPendingCount();
  return s_pending;
#else
  return 0;
#endif
}

bool hasDropped() {
#if ENABLE_CLOUD
  return Storage::uploadQueueDropped();
#else
  return false;
#endif
}

void clearDroppedFlag() {
#if ENABLE_CLOUD
  Storage::clearUploadQueueDropped();
#endif
}

uint32_t peekOldestSeq() {
#if ENABLE_CLOUD
  uint32_t seq = 0;
  bool found = false;
  scanOldest(seq, found);
  return found ? seq : 0;
#else
  return 0;
#endif
}

bool readOldest(String& jsonOut) {
#if ENABLE_CLOUD
  jsonOut = "";
  uint32_t seq = 0;
  bool found = false;
  if (!scanOldest(seq, found) || !found) return false;

  char path[40];
  pathForSeq(seq, path, sizeof(path), "json");
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  jsonOut.reserve(f.size() > 0 ? (unsigned)f.size() : 256);
  jsonOut = f.readString();
  f.close();
  return jsonOut.length() > 0 && jsonOut[0] == '{';
#else
  (void)jsonOut;
  return false;
#endif
}

bool removeOldest() {
#if ENABLE_CLOUD
  uint32_t seq = peekOldestSeq();
  if (seq == 0) return false;
  char path[40];
  pathForSeq(seq, path, sizeof(path), "json");
  if (!LittleFS.remove(path)) return false;
  if (s_pending > 0) s_pending--;
  return true;
#else
  return false;
#endif
}

} // namespace UploadQueue
