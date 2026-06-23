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
// --- Touch build: "Nothing" centred layout — dot-matrix timer, dotted progress,
// thin-outline controls. The single red accent appears only on progress/active.
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
  const Palette&   pal = Theme::palette();
  g->fillScreen(pal.bg);
  g->setTextSize(1);
  const bool paused = (m.state == ST_PAUSED);
  const int  cx = 160;

  // Phase label — small, muted, lowercase (sparse).
  g->setTextDatum(middle_center);
  g->setFont(FONT_S);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString(paused ? "paused" : phaseName(m.mode, isLongBreak(m)), cx, 26);

  // Dot-matrix timer (Nothing signature) — or a single dot in eyes-off mode.
  if (m.showTimer) {
    int s = m.remainingSec < 0 ? 0 : m.remainingSec;
    char t[8]; snprintf(t, sizeof(t), "%02d:%02d", s / 60, s % 60);
    DotFont::drawCentered(g, t, cx, 92, 3, 7, pal.text, pal.segment);
  } else {
    g->fillCircle(cx, 92, 5, pal.text);   // eyes-off: running, no time shown
  }

  // Dotted progress bar — lit (red) up to elapsed fraction.
  {
    float f = (m.targetSec > 0) ? 1.0f - (float)m.remainingSec / m.targetSec : 0;
    if (f < 0) f = 0; if (f > 1) f = 1;
    const int N = 21, step = 10, x0 = cx - (N - 1) * step / 2, y = 140;
    for (int i = 0; i < N; i++)
      g->fillCircle(x0 + i * step, y, 2,
                    ((float)i / (N - 1) <= f) ? C_ACCENT : pal.divider);
  }

  // Cycle dots — filled red when done, thin outline when pending.
  if (m.setCycleTotal > 1) {
    const int n = m.setCycleTotal, r = 3, step = 16;
    const int x0 = cx - (n - 1) * step / 2, y = 165;
    for (int i = 0; i < n; i++) {
      int x = x0 + i * step;
      if (i < m.setFocusDone) g->fillCircle(x, y, r, C_ACCENT);
      else                    g->drawCircle(x, y, r, pal.muted);
    }
  }

  // Environment interference — the one red warning line (nothing when all clear).
  if (m.interference != INTERF_NONE) {
    g->setFont(FONT_S);
    g->setTextColor(C_ACCENT, pal.bg);
    g->drawString(interferenceLabel(m.interference), cx, 188);
  }

  // Thin-outline controls; only the centre (play/pause) carries the red ring.
  for (auto& bt : kButtons) {
    uint16_t ring = (bt.action == TA_PAUSE) ? C_ACCENT
                  : (bt.action == TA_MENU)  ? pal.muted : pal.text;
    g->drawCircle(bt.cx, bt.cy, bt.r, ring);
    switch (bt.action) {
      case TA_RESET: Icons::skipPrev(g, bt.cx, bt.cy, pal.text); break;
      case TA_PAUSE:
        if (paused) Icons::play(g, bt.cx, bt.cy, pal.text);
        else        Icons::pause(g, bt.cx, bt.cy, pal.text);
        break;
      case TA_SKIP:  Icons::skipNext(g, bt.cx, bt.cy, pal.text); break;
      case TA_MENU:  Icons::drawMenuIcon(g, MI_SETTINGS, bt.cx, bt.cy, pal.muted); break;
    }
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
