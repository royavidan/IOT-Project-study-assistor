#pragma once
// ============================================================================
// UploadQueue — durable offline backlog for completed sessions (Part B).
// Writes canonical Payload JSON to LittleFS; Cloud::tick() drains when online.
// ============================================================================
#include "types.h"
#include <Arduino.h>

namespace UploadQueue {
  void begin();

  // Prefer enqueueJson (one JSON build) over enqueue (rebuilds from samples).
  bool enqueueJson(uint32_t clientSeq, const String& json);
  bool enqueue(const SessionRecord& r, const Sample* samples, int n);

  int  pendingCount();
  bool hasDropped();
  void clearDroppedFlag();

  uint32_t peekOldestSeq();
  bool readOldest(String& jsonOut);
  bool removeOldest();
}
