#include "Display.h"
#include "config.h"
#include "Storage.h"
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

// right-aligned size-1 text
static void rtext(const char* s, int y) {
  if (!gfx) return;
  gfx->setTextSize(1); gfx->setTextColor(OLED_WHITE);
  int16_t x1, y1; uint16_t w, h;
  gfx->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  gfx->setCursor(OLED_W - (int)w, y); gfx->print(s);
}

static void menuHeader(const MenuView& m) {
  if (m.showBrand) text(0, 0, 1, "MindBox");
  else             text(0, 0, 1, m.title);
  if (m.statusWord[0]) rtext(m.statusWord, 0);
  if (gfx) gfx->drawLine(0, 10, OLED_W - 1, 10, OLED_WHITE);
}

static void menuRow(int y, const MenuRow& row) {
  char line[24];
  if (row.selected) snprintf(line, sizeof(line), ">%s", row.label);
  else              snprintf(line, sizeof(line), " %s", row.label);
  text(0, y, 1, line);
  if (row.hasValue) rtext(row.value, y);
}

void renderMenu(const MenuView& m) {
  if (!gfx) return;
  clear();

  if (m.durationEditor) {
    center(m.title[0] ? m.title : "MINUTES", 2, 1);
    char b[8]; snprintf(b, sizeof(b), "%d", m.durationMin);
    center(b, 18, 3);
    center("minutes", 44, 1);
    bar(14, 54, 100, 8, m.durationFrac);
    show();
    return;
  }

  menuHeader(m);
  if (m.infoLine[0]) center(m.infoLine, 14, 1);

  int baseY = m.infoLine[0] ? 26 : 14;
  for (uint8_t i = 0; i < m.rowCount; i++) {
    int y = baseY + (int)i * 10;
    if (i > 0 && m.accountEmail[0]) y += 8;
    menuRow(y, m.rows[i]);
    if (i == 0 && m.accountEmail[0]) text(2, baseY + 9, 1, m.accountEmail);
  }
  show();
}

// --- per-state screens ------------------------------------------------------
static void sPairing(const UiModel& m) {
  clear();
  char id[24]; snprintf(id, sizeof(id), "id %s", (m.deviceId && m.deviceId[0]) ? m.deviceId : "?");
  if (m.paired) {
    center("PAIRED", 0, 1);
    String owner = Storage::ownerDisplayName();
    String email = Storage::ownerEmail();
    if (owner.length())
      center(owner.c_str(), 16, 1);
    if (email.length()) {
      String line = email;
      if (line.length() > 21) line = line.substring(0, 21);
      center(line.c_str(), owner.length() ? 28 : 16, 1);
    } else if (!owner.length()) {
      center("linked to account", 28, 1);
    }
  } else if (m.wifi && m.pairCode && m.pairCode[0]) {
    center("PAIR THIS BOX", 0, 1);
    center(m.pairCode, 20, 2);                           // 6-digit code (hero)
    center("enter in MindBox app", 44, 1);
  } else {
    center("PAIR THIS BOX", 0, 1);
    center(id, 16, 1);
    center("connect Wi-Fi, then", 32, 1);
    center("pair in the app", 42, 1);
  }
  center("side: ok  hold: back", 56, 1);
  show();
}
static void sRunning(const UiModel& m) {
  if (!m.showTimer && !m.coachingNudge) { clear(); show(); return; }
  int s = m.remainingSec < 0 ? 0 : m.remainingSec;
  char t[8]; snprintf(t, sizeof(t), "%02d:%02d", s / 60, s % 60);
  char hdr[16];
  if (m.setActive && m.setCycleTotal > 1) {
    if (m.mode == MODE_WORK)
      snprintf(hdr, sizeof(hdr), "WORK %d/%d", m.setFocusDone + 1, m.setCycleTotal);
    else
      snprintf(hdr, sizeof(hdr), "BREAK");
  } else {
    snprintf(hdr, sizeof(hdr), "%s", modeName(m.mode));
  }
  clear();
  if (m.showTimer) {
    text(0, 0, 1, hdr);
    if (m.wifi) text(OLED_W - 24, 0, 1, "wifi");
    center(t, 20, 3);
    if (m.coachingNudge)
      center("Consider a break", 44, 1);
    bar(8, 54, 112, 8, m.targetSec > 0 ? 1.0f - (float)s / m.targetSec : 0);
  } else if (m.coachingNudge) {
    text(0, 0, 1, hdr);
    center("Consider a break", 28, 1);
  }
  show();
}
static void sPaused(const UiModel& m) {
  clear();
  center("PAUSED", 0, 2);
  center(pauseReasonLine(m.pauseReason), 24, 1);
  if (m.pauseReason == PAUSE_AWAY)
    center("step back to resume", 44, 1);
  show();
}
static void sComplete(const UiModel& m) {
  clear();
  if (m.setComplete) {
    center("SET DONE", 0, 2);
    char b[24];
    snprintf(b, sizeof(b), "%d cycles", m.setCycleTotal);
    center(b, 28, 1);
    show();
    return;
  }
  center("DONE", 0, 2);
  char b[24];
  int targetM = m.targetSec / 60;
  snprintf(b, sizeof(b), "%dm / %dm", m.actualFocusMin, targetM > 0 ? targetM : m.durationMin);
  center(b, 22, 1);
  if (m.sessionBreaks > 0 || m.sessionPresInt > 0) {
    snprintf(b, sizeof(b), "%d brk  %d away", m.sessionBreaks, m.sessionPresInt);
    center(b, 38, 1);
  }
  show();
}

void render(const UiModel& m) {
  switch (m.state) {
    case ST_BOOTING:  clear(); center("MindBox", 18, 2); center("starting...", 44, 1); show(); break;
    case ST_IDLE:     /* Menu::renderMenu */ break;
    case ST_RUNNING:  sRunning(m);  break;
    case ST_PAUSED:   sPaused(m);   break;
    case ST_COMPLETE: sComplete(m); break;
    case ST_LOGGING:  clear(); center("syncing...", 24, 1); show(); break;
    case ST_ERROR:    clear(); center("SENSOR FAULT", 12, 1); center("long-press to reset", 40, 1); show(); break;
    case ST_PAIRING:  sPairing(m);  break;
    case ST_DIAG:     /* drawn by StateMachine::renderDiag() */ break;
    default:          break;   // ST_RESUME / ST_CYCLE_OFFER render via Menu upstream
  }
}

} // namespace Display
