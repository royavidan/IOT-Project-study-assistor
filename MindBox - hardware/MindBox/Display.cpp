#include "Display.h"
#include "config.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <Adafruit_SSD1306.h>

static Adafruit_SH1106G sh1106(OLED_W, OLED_H, &Wire, -1);
static Adafruit_SSD1306 ssd1306(OLED_W, OLED_H, &Wire, -1);
static Adafruit_GFX*    gfx   = nullptr;
static bool             useSH = false;

namespace Display {

bool init() {
  const uint8_t addrs[2] = { 0x3C, 0x3D };
  for (uint8_t a : addrs) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() != 0) continue;
    if (sh1106.begin(a, true))                  { useSH = true;  gfx = &sh1106;  return true; }
    if (ssd1306.begin(SSD1306_SWITCHCAPVCC, a)) { useSH = false; gfx = &ssd1306; return true; }
  }
  return false;
}

bool        present()    { return gfx != nullptr; }
const char* driverName() { return gfx ? (useSH ? "SH1106" : "SSD1306") : "none"; }

void clear() { if (!gfx) return; useSH ? sh1106.clearDisplay() : ssd1306.clearDisplay(); }
void show()  { if (!gfx) return; useSH ? sh1106.display()      : ssd1306.display(); }

void text(int x, int y, int size, const char* s) {
  if (!gfx) return;
  gfx->setTextSize(size); gfx->setTextColor(OLED_WHITE); gfx->setCursor(x, y); gfx->print(s);
}

void center(const char* s, int y, int size) {
  if (!gfx) return;
  gfx->setTextSize(size); gfx->setTextColor(OLED_WHITE);
  int16_t x1, y1; uint16_t w, h;
  gfx->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  gfx->setCursor((OLED_W - (int)w) / 2 - x1, y); gfx->print(s);
}

void bar(int x, int y, int w, int h, float frac) {
  if (!gfx) return;
  if (frac < 0) frac = 0; if (frac > 1) frac = 1;
  gfx->drawRect(x, y, w, h, OLED_WHITE);
  int fw = (int)((w - 2) * frac);
  if (fw > 0) gfx->fillRect(x + 1, y + 1, fw, h - 2, OLED_WHITE);
}

// --- per-state screens ------------------------------------------------------
static void sIdle(const UiModel& m) {
  clear(); center("MINDBOX", 12, 2);
  char b[28]; snprintf(b, sizeof(b), "ready  -  %s", modeName(m.mode));
  center(b, 36, 1); center("turn knob to begin", 52, 1); show();
}
static void sSetup(const UiModel& m) {
  clear(); center("set duration", 2, 1);
  char b[8]; snprintf(b, sizeof(b), "%d", m.durationMin); center(b, 18, 3);
  center("minutes", 44, 1);
  bar(14, 54, 100, 8, (float)(m.durationMin - DUR_MIN_MIN) / (DUR_MAX_MIN - DUR_MIN_MIN));
  show();
}
static void sArmed(const UiModel& m) {
  clear(); center("READY", 6, 2); center(modeName(m.mode), 28, 1);
  center("press button to start", 46, 1); show();
}
static void sRunning(const UiModel& m) {
  if (!m.showTimer) { clear(); show(); return; }   // site setting: eyes-off
  int s = m.remainingSec < 0 ? 0 : m.remainingSec;
  char t[8]; snprintf(t, sizeof(t), "%02d:%02d", s / 60, s % 60);
  clear(); text(0, 0, 1, modeName(m.mode));
  if (m.wifi) text(OLED_W - 24, 0, 1, "wifi");
  center(t, 20, 3);
  bar(8, 54, 112, 8, m.targetSec > 0 ? 1.0f - (float)s / m.targetSec : 0);
  show();
}
static void sPaused() {
  clear(); center("PAUSED", 12, 2); center("step back to resume", 40, 1); show();
}
static void sComplete(const UiModel& m) {
  clear(); center("DONE", 8, 2);
  char b[24]; snprintf(b, sizeof(b), "%d min focused", m.actualFocusMin);
  center(b, 36, 1); show();
}

void render(const UiModel& m) {
  switch (m.state) {
    case ST_BOOTING:  clear(); center("MindBox", 18, 2); center("starting...", 44, 1); show(); break;
    case ST_IDLE:     sIdle(m);     break;
    case ST_SETUP:    sSetup(m);    break;
    case ST_ARMED:    sArmed(m);    break;
    case ST_RUNNING:  sRunning(m);  break;
    case ST_PAUSED:   sPaused();    break;
    case ST_COMPLETE: sComplete(m); break;
    case ST_LOGGING:  clear(); center("syncing...", 24, 1); show(); break;
    case ST_ERROR:    clear(); center("SENSOR FAULT", 12, 1); center("long-press to reset", 40, 1); show(); break;
    case ST_DIAG:     /* drawn by StateMachine::renderDiag() */ break;
  }
}

} // namespace Display
