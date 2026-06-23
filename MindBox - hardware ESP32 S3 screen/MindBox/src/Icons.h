#pragma once
// ============================================================================
// Icons.h — transport-control glyphs drawn from primitives (no font/bitmaps),
// in white over the accent-blue buttons. Centred on (cx, cy).
// ============================================================================
#ifndef LGFX_USE_V1
#define LGFX_USE_V1            // must be set in every TU before LovyanGFX is included
#endif
#include <LovyanGFX.hpp>
#include <math.h>
#include "types.h"   // MenuIcon ids

namespace Icons {

inline void play(lgfx::LovyanGFX* g, int cx, int cy, uint16_t col) {
  g->fillTriangle(cx - 6, cy - 10, cx - 6, cy + 10, cx + 10, cy, col);
}

inline void pause(lgfx::LovyanGFX* g, int cx, int cy, uint16_t col) {
  g->fillRect(cx - 7, cy - 9, 5, 18, col);
  g->fillRect(cx + 2, cy - 9, 5, 18, col);
}

inline void skipNext(lgfx::LovyanGFX* g, int cx, int cy, uint16_t col) {
  g->fillTriangle(cx - 8, cy - 8, cx - 8, cy + 8, cx + 2, cy, col);
  g->fillRect(cx + 3, cy - 8, 3, 16, col);
}

inline void skipPrev(lgfx::LovyanGFX* g, int cx, int cy, uint16_t col) {
  g->fillTriangle(cx + 8, cy - 8, cx + 8, cy + 8, cx - 2, cy, col);
  g->fillRect(cx - 6, cy - 8, 3, 16, col);
}

// ----------------------------------------------------------------------------
// Menu-tile glyphs — simple monochrome primitives (~16 px) knocked out in `col`
// (the tile's background colour) over a coloured rounded-square badge. Centred
// on (cx, cy). Keyed off the MenuIcon ids in types.h.
// ----------------------------------------------------------------------------
inline void drawMenuIcon(lgfx::LovyanGFX* g, uint8_t icon, int cx, int cy, uint16_t col) {
  switch (icon) {
    case MI_START:                                   // play triangle
      g->fillTriangle(cx - 5, cy - 7, cx - 5, cy + 7, cx + 7, cy, col);
      break;
    case MI_MODE:                                    // cycle: ring + arrowhead
      g->drawCircle(cx, cy, 7, col);
      g->drawCircle(cx, cy, 6, col);
      g->fillTriangle(cx + 7, cy - 6, cx + 7, cy + 1, cx + 11, cy - 3, col);
      break;
    case MI_SETTINGS:                                // gear: hub + spokes
      g->fillCircle(cx, cy, 3, col);
      g->drawCircle(cx, cy, 7, col);
      for (int a = 0; a < 360; a += 45) {
        float r = a * 0.01745329f;
        g->drawLine(cx + (int)(5 * cosf(r)), cy + (int)(5 * sinf(r)),
                    cx + (int)(9 * cosf(r)), cy + (int)(9 * sinf(r)), col);
      }
      break;
    case MI_PRESENCE:                                // proximity: dot + arcs (opening right)
      g->fillCircle(cx - 5, cy, 2, col);
      g->fillArc(cx - 5, cy, 6, 7, -60, 60, col);
      g->fillArc(cx - 5, cy, 10, 11, -60, 60, col);
      break;
    case MI_DISPLAY:                                 // eye
      g->drawEllipse(cx, cy, 9, 5, col);
      g->fillCircle(cx, cy, 2, col);
      break;
    case MI_COACHING:                                // lightbulb
      g->drawCircle(cx, cy - 2, 6, col);
      g->fillRect(cx - 3, cy + 4, 6, 3, col);
      g->fillRect(cx - 2, cy + 7, 4, 2, col);
      break;
    case MI_STATS:                                   // bar chart
      g->fillRect(cx - 8, cy + 1, 4, 6, col);
      g->fillRect(cx - 2, cy - 3, 4, 10, col);
      g->fillRect(cx + 4, cy - 6, 4, 13, col);
      break;
    case MI_HISTORY:                                 // clock
      g->drawCircle(cx, cy, 8, col);
      g->drawLine(cx, cy, cx, cy - 5, col);
      g->drawLine(cx, cy, cx + 4, cy + 2, col);
      break;
    case MI_GOAL:                                    // target
      g->drawCircle(cx, cy, 8, col);
      g->drawCircle(cx, cy, 4, col);
      g->fillCircle(cx, cy, 1, col);
      break;
    case MI_DEVICE:                                  // box
      g->drawRoundRect(cx - 7, cy - 6, 14, 12, 2, col);
      g->drawFastHLine(cx - 7, cy - 1, 14, col);
      break;
    case MI_PAIR:                                    // link (two rings)
      g->drawCircle(cx - 4, cy, 4, col);
      g->drawCircle(cx + 4, cy, 4, col);
      break;
    case MI_WIFI:                                    // wifi arcs + dot (opening up)
      g->fillCircle(cx, cy + 6, 2, col);
      g->fillArc(cx, cy + 6, 5, 6, 210, 330, col);
      g->fillArc(cx, cy + 6, 9, 10, 210, 330, col);
      break;
    case MI_DIAG:                                    // wrench
      g->drawLine(cx - 6, cy + 6, cx + 3, cy - 3, col);
      g->drawLine(cx - 5, cy + 6, cx + 4, cy - 3, col);
      g->drawCircle(cx + 5, cy - 5, 3, col);
      break;
    case MI_ABOUT:                                   // info "i"
      g->fillCircle(cx, cy - 6, 1, col);
      g->fillRect(cx - 1, cy - 3, 2, 9, col);
      break;
    case MI_BACK:                                    // left chevron
      g->fillTriangle(cx + 4, cy - 7, cx + 4, cy + 7, cx - 5, cy, col);
      break;
    default: break;                                  // MI_NONE
  }
}

} // namespace Icons
