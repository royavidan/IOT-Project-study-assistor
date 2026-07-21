#pragma once
// ============================================================================
// focus_load.h — Focus Load Estimate heuristic (0..100).
// KEEP IN SYNC with mindbox-companion-forge-main/src/lib/focus-load.ts so the
// firmware, simulator, and app all compute the same number.
// Always an *estimate*, never a clinical measurement (Story 10).
// ============================================================================
#include "config.h"

namespace FocusLoad {

inline float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

//   FLE = 0.3*(elapsed/target) + 0.3*noise + 0.2*lightVar + 0.2*presence
inline int compute(float elapsedSec, float targetSec,
                   float nNoise, float lightVar, int presence) {
  float er = targetSec > 0 ? clamp01(elapsedSec / targetSec) : 0;
  float n  = clamp01(nNoise);
  float l  = clamp01(lightVar);
  float p  = clamp01((float)presence / FLE_PRESENCE_CAP);
  float s  = 0.3f * er + 0.3f * n + 0.2f * l + 0.2f * p;
  int v = (int)(s * 100.0f + 0.5f);
  return v < 0 ? 0 : (v > 100 ? 100 : v);
}

} // namespace FocusLoad
