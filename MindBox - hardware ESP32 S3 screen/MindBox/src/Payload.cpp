#include "Payload.h"
#include <math.h>

// NaN/Inf are not valid JSON — coerce to 0 (e.g. tempC when no temp sensor).
static String num(float v, unsigned int prec = 3) {
  if (isnan(v) || isinf(v)) v = 0;
  return String(v, prec);
}

static String jstr(const char* s) {
  String o = "\"";
  o += (s ? s : "");
  o += "\"";
  return o;
}

namespace Payload {

String isoFromEpoch(time_t t) {
  struct tm tmv;
  gmtime_r(&t, &tmv);
  char b[25];
  strftime(b, sizeof(b), "%Y-%m-%dT%H:%M:%SZ", &tmv);
  return String(b);
}

String sessionJson(const SessionRecord& r, const Sample* samples, int n,
                   const char* deviceId, const char* profileId) {
  String j;
  j.reserve(320 + (size_t)n * 96);

  j += "{";
  j += "\"deviceId\":";             j += jstr(deviceId);                       j += ",";
  j += "\"profileId\":";            j += jstr(profileId);                      j += ",";
  j += "\"sessionId\":";            j += jstr(r.sessionId);                    j += ",";
  j += "\"clientSeq\":";            j += String((unsigned long)r.clientSeq);   j += ",";
  j += "\"startedAt\":";            j += jstr(isoFromEpoch(r.startedAt).c_str()); j += ",";
  j += "\"endedAt\":";              j += jstr(isoFromEpoch(r.endedAt).c_str());   j += ",";
  j += "\"targetDurationSec\":";    j += String(r.targetSec);                  j += ",";
  j += "\"actualFocusSec\":";       j += String(r.actualFocusSec);             j += ",";
  j += "\"mode\":";                 j += jstr(modeName(r.mode));               j += ",";
  j += "\"status\":";               j += jstr(r.status);                       j += ",";
  j += "\"breaks\":";               j += String(r.breaks);                     j += ",";
  j += "\"presenceInterruptions\":";j += String(r.presenceInterruptions);      j += ",";
  j += "\"awayMs\":";               j += String((unsigned long)r.awayMs);      j += ",";

  j += "\"env\":{";
  j += "\"noiseAvg\":";   j += num(r.noiseAvg);     j += ",";
  j += "\"noisePeak\":";  j += num(r.noisePeak);    j += ",";
  j += "\"tempC\":";      j += num(r.tempC, 1);     j += ",";
  j += "\"lightLux\":";   j += num(r.lightLux, 0);
  j += "},";

  j += "\"focusLoadSamples\":[";
  for (int i = 0; i < n; i++) {
    if (i) j += ",";
    j += "{\"t\":";       j += String(samples[i].t);
    j += ",\"value\":";   j += String(samples[i].fle);   j += "}";
  }
  j += "],";

  j += "\"focusLoadAvg\":"; j += String(r.focusLoadAvg); j += ",";

  j += "\"envSamples\":[";
  for (int i = 0; i < n; i++) {
    if (i) j += ",";
    j += "{\"t\":";        j += String(samples[i].t);
    j += ",\"noise\":";    j += num(samples[i].noise);
    j += ",\"tempC\":";    j += num(samples[i].tempC, 1);
    j += ",\"lightLux\":"; j += num(samples[i].lightLux, 0); j += "}";
  }
  j += "]";
  j += "}";
  return j;
}

} // namespace Payload
