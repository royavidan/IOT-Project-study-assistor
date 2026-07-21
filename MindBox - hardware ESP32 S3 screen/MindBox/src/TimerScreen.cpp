#include "TimerScreen.h"
#include "Theme.h"
#include "Fonts.h"
#include "DotFont.h"
#include "Icons.h"
#include "Sensors.h"
#include "Panel.h"
#include <Arduino.h>
#include <math.h>

namespace TimerScreen {

// A BREAK is a "long break" when the set's focus blocks are all done.
static inline bool isLongBreak(const UiModel& m) {
  return m.mode == MODE_BREAK && m.setActive && m.setFocusDone >= m.setCycleTotal;
}

#if USE_TOUCH
// --- Touch build: centred dot-matrix numerals inside a dotted progress RING, coloured by phase
// (focus=red, short break=teal, long break=blue). No on-screen chrome — a tap anywhere opens the menu.
struct Btn { int cx, cy, r; int action; };
static const Btn kButtons[4] = {
  { 108, 212, 16, TA_RESET },  // restart interval
  { 160, 212, 20, TA_PAUSE },  // play / pause (centre, larger)
  { 212, 212, 16, TA_SKIP  },  // skip to next interval
  { 300,  26, 14, TA_MENU  },  // top-right — session options (gear)
};

int hitTest(int x, int y) {
  for (auto& b : kButtons) {
    int dx = x - b.cx, dy = y - b.cy;
    int rr = b.r + 8;                 // a little touch padding
    if (dx * dx + dy * dy <= rr * rr) return b.action;
  }
  return TA_NONE;
}

void render(const UiModel& m) {
  lgfx::LovyanGFX* g = Panel::canvas();
  const Palette&  pal = Theme::palette();
  const bool      paused = (m.state == ST_PAUSED);
  const bool      lb = isLongBreak(m);
  // The colour lives in the RING on a calm dark face (Apple's HIG: Activity rings live on black, never a
  // fully-tinted screen — that's what fatigues the eye). Paused dims the ring to muted so it reads as "held".
  const uint16_t  ring  = paused ? pal.muted   : phaseColor(m.mode, lb);
  const uint16_t  track = paused ? pal.segment : phaseTrack(m.mode, lb);
  g->fillScreen(pal.bg);
  g->setTextSize(1);
  const int cx = 160, cy = 110, rOut = 88, rIn = 74;

  // Professional progress RING: an always-visible subtle TRACK (full circle) + a vivid phase-coloured PROGRESS
  // arc sweeping clockwise from 12 o'clock with SHARP, crisp flat ends — no soft anti-aliased caps (those band
  // and look fuzzy at 8-bit). fillArc 0deg = 3 o'clock, clockwise on screen, so 12 o'clock = 270deg; split at
  // the 0/360 seam. fillArc draws solid hard edges, so the fill stays crisp.
  {
    float f = (m.targetSec > 0) ? 1.0f - (float)m.remainingSec / m.targetSec : 0;
    if (f < 0) f = 0; if (f > 1) f = 1;
    g->fillArc(cx, cy, rIn, rOut, 0, 360, track);                  // full track, always visible
    if (f > 0.0f) {
      float endA = 270.0f + 360.0f * f;                            // start at top (270), sweep clockwise
      if (endA <= 360.0f) {
        g->fillArc(cx, cy, rIn, rOut, 270.0f, endA, ring);
      } else {                                                     // wrapped past the 0/360 seam -> two spans
        g->fillArc(cx, cy, rIn, rOut, 270.0f, 360.0f, ring);
        g->fillArc(cx, cy, rIn, rOut, 0.0f, endA - 360.0f, ring);
      }
    }
  }

  // Phase label — small, muted, centred above the numerals.
  g->setTextDatum(middle_center);
  g->setFont(FONT_S);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString(paused ? "paused" : phaseName(m.mode, lb), cx, cy - 40);

  // Hero numerals — a real bold bundled font (FreeMonoBold24pt7b), not the pixel dot-matrix. Phone-style
  // "M:SS"; for >=100 min fall back to FONT_L so "120:00" still fits inside the ring hole.
  if (m.showTimer) {
    int s = m.remainingSec < 0 ? 0 : m.remainingSec;
    int mins = s / 60;
    char t[8]; snprintf(t, sizeof(t), "%d:%02d", mins, s % 60);
    g->setFont(mins >= 100 ? FONT_L : FONT_XL);
    g->setTextDatum(middle_center);
    g->setTextColor(pal.text, pal.bg);
    g->drawString(t, cx, cy);
  } else {
    g->fillSmoothCircle(cx, cy, 6, pal.text);   // eyes-off: running, no time shown
  }

  // Cycle pips BELOW the ring (running only) — done = ring colour, pending = muted outline.
  if (!paused && m.setCycleTotal > 1) {
    const int n = m.setCycleTotal, r = 3, step = 16;
    const int x0 = cx - (n - 1) * step / 2, y = 212;
    for (int i = 0; i < n; i++) {
      int x = x0 + i * step;
      if (i < m.setFocusDone) g->fillCircle(x, y, r, ring);
      else                    g->drawCircle(x, y, r, pal.muted);
    }
  }

  // Environment interference — warm amber alert below the ring (distinct from any ring hue).
  if (!paused && m.interference != INTERF_NONE) {
    g->setTextDatum(middle_center);
    g->setFont(FONT_S);
    g->setTextColor(C_ALERT, pal.bg);
    g->drawString(interferenceLabel(m.interference), cx, m.setCycleTotal > 1 ? 228 : 212);
  }

  // PAUSED affordance: a play triangle + "tap to resume" — ANY tap resumes (StateMachine ST_PAUSED). RUNNING
  // has NO chrome — tapping anywhere opens the Pause/Skip/End/Settings menu (gear + hint removed).
  if (paused) {
    const int py = 210;
    g->fillTriangle(cx - 7, py - 9, cx - 7, py + 9, cx + 10, py, pal.text);    // play / resume glyph
    g->setTextDatum(middle_center);
    g->setFont(FONT_S);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString("tap to resume", cx, 228);
  }

  // Local time, top-left corner (online only) — clear of the centered env-icon row.
  if (m.clockStr[0]) {
    g->setTextDatum(top_left);
    g->setFont(FONT_S);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(m.clockStr, 8, 8);
  }

  // Live environment status row (top): temp / noise / light / away icons — lit (accent) when active now, else dim.
  {
    const int iy = 14, step = 30;
    int n = 0;
#if HAS_TEMP
    n++;
#endif
#if HAS_ANY_MIC
    n++;
#endif
#if HAS_LIGHT
    n++;
#endif
#if HAS_PRESENCE
    n++;
#endif
    int ex = cx - (n - 1) * step / 2;
#if HAS_TEMP
    Icons::drawMenuIcon(g, MI_TEMP,     ex, iy, m.envHot  ? C_ACCENT : pal.muted); ex += step;
#endif
#if HAS_ANY_MIC
    Icons::drawMenuIcon(g, MI_NOISE,    ex, iy, m.envLoud ? C_ACCENT : pal.muted); ex += step;
#endif
#if HAS_LIGHT
    Icons::drawMenuIcon(g, MI_LIGHT,    ex, iy, m.envDim  ? C_ACCENT : pal.muted); ex += step;
#endif
#if HAS_PRESENCE
    Icons::drawMenuIcon(g, MI_PRESENCE, ex, iy, m.envAway ? C_ACCENT : pal.muted); ex += step;
#endif
    (void)ex;
  }

  Panel::push();
}

#else
// --- No-touch build: "Nothing" centred dotted ring + dot-matrix numerals -----
void render(const UiModel& m) {
  lgfx::LovyanGFX* g = Panel::canvas();
  const Palette&   pal = Theme::palette();
  g->fillScreen(pal.bg);
  g->setTextSize(1);
  const bool     paused = (m.state == ST_PAUSED);
  const uint16_t accent = paused ? pal.muted : phaseColor(m.mode, isLongBreak(m));

  const int cx = 160, cy = 120, rad = 86, N = 44;
  float f = (m.targetSec > 0) ? 1.0f - (float)m.remainingSec / m.targetSec : 0;
  if (f < 0) f = 0; if (f > 1) f = 1;
  for (int i = 0; i < N; i++) {                 // dotted ring, lit up to f
    float a = (-90.0f + 360.0f * i / N) * DEG_TO_RAD;
    int x = cx + (int)lroundf(rad * cosf(a));
    int y = cy + (int)lroundf(rad * sinf(a));
    g->fillCircle(x, y, 2, ((float)i / N <= f) ? accent : pal.divider);
  }

  g->setTextDatum(middle_center);
  g->setFont(FONT_S);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString(paused ? "paused" : phaseName(m.mode, isLongBreak(m)), cx, cy - 44);

  int s = m.remainingSec < 0 ? 0 : m.remainingSec;
  char t[8]; snprintf(t, sizeof(t), "%02d:%02d", s / 60, s % 60);
  DotFont::drawCentered(g, t, cx, cy, 2, 4, pal.text, pal.segment);

  if (m.setCycleTotal > 1) {
    const int n = m.setCycleTotal, r = 3, step = 16;
    const int x0 = cx - (n - 1) * step / 2, y = cy + 40;
    for (int i = 0; i < n; i++) {
      int x = x0 + i * step;
      if (i < m.setFocusDone) g->fillCircle(x, y, r, accent);
      else                    g->drawCircle(x, y, r, pal.muted);
    }
  }

  g->setFont(FONT_S);
  if (m.coachingNudge) {
    g->setTextColor(C_ACCENT, pal.bg);
    g->drawString("consider a break", cx, 224);
  } else if (m.setActive && m.setCycleTotal > 1) {
    char b[16];
    int done = m.setFocusDone < m.setCycleTotal ? m.setFocusDone + 1 : m.setCycleTotal;
    snprintf(b, sizeof(b), "set %d/%d", done, m.setCycleTotal);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(b, cx, 224);
  }

  Panel::push();
}
#endif

} // namespace TimerScreen
