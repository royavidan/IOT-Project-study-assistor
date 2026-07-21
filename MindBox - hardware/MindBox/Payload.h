#pragma once
// ============================================================================
// Payload — canonical device->cloud JSON serializer. Builds ONE SessionPayload
// that matches src/lib/focus-load.ts and passes the Zod schema in
// src/lib/ingest/ingest.server.ts. This is the single source of the upload
// shape; Cloud (Part C) and the upload queue (Part B) both go through it.
// ============================================================================
#include "types.h"
#include <time.h>

namespace Payload {
  // JSON for one session. profileId is the on-device slot (default "A").
  String sessionJson(const SessionRecord& r, const Sample* samples, int n,
                     const char* deviceId, const char* profileId = "A");

  // ISO-8601 UTC from epoch seconds; epoch 0 -> 1970 (offline, backfilled later).
  String isoFromEpoch(time_t t);
}
