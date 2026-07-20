#include "Display.h"
#include "Panel.h"
#include "Theme.h"
#include "Fonts.h"
#include "DotFont.h"
#include "Icons.h"
#include "TimerScreen.h"
#include "Storage.h"
#include <Arduino.h>

namespace Display {

// OLED(128x64)->TFT(320x240) scale for the primitive-drawn screens. Uniform
// scale, vertically centred (64*2.5 = 160, leaving a 40px band top/bottom).
static const float SCL  = (float)SCR_W / (float)OLED_W;   // 2.5
static const int   YOFF = (SCR_H - (int)(OLED_H * SCL)) / 2;

static inline lgfx::LovyanGFX* G() { return Panel::canvas(); }

// Touch hit-test state, refreshed by renderMenu()/render()/clear().
struct RowRect { int y0, y1, idx; };
static RowRect s_rows[MENU_VISIBLE_ROWS];
static int     s_rowCount    = 0;
static int     s_selectedRow = -1;   // visible index of the cursor row
static bool    s_hasBack     = false;
static const int BACK_W = 66, BACK_H = 42;   // generous tap target, top-left

// --- lifecycle --------------------------------------------------------------
bool        init()       { Panel::begin(); return true; }
bool        present()    { return true; }
const char* driverName() { return "ILI9341"; }

// --- low-level primitives (used by the diag / wifi-setup screens) -----------
void clear() {
  G()->fillScreen(Theme::palette().bg);
  s_rowCount = 0; s_selectedRow = -1; s_hasBack = false;  // no tap targets here
}
void show()  { Panel::push(); }

void text(int x, int y, int size, const char* s) {
  lgfx::LovyanGFX* g = G();
  const Palette& pal = Theme::palette();
  g->setFont(&fonts::Font0);
  g->setTextSize(size * 2);
  g->setTextColor(pal.text, pal.bg);
  g->setTextDatum(top_left);
  g->setCursor((int)(x * SCL), YOFF + (int)(y * SCL));
  g->print(s);
}

void center(const char* s, int y, int size) {
  lgfx::LovyanGFX* g = G();
  const Palette& pal = Theme::palette();
  g->setFont(&fonts::Font0);
  g->setTextSize(size * 2);
  g->setTextColor(pal.text, pal.bg);
  g->setTextDatum(top_center);
  g->drawString(s, SCR_W / 2, YOFF + (int)(y * SCL));
}

void bar(int x, int y, int w, int h, float frac) {
  lgfx::LovyanGFX* g = G();
  const Palette& pal = Theme::palette();
  if (frac < 0) frac = 0; if (frac > 1) frac = 1;
  int X = (int)(x * SCL), Y = YOFF + (int)(y * SCL), W = (int)(w * SCL), H = (int)(h * SCL);
  g->drawRect(X, Y, W, H, pal.text);
  int fw = (int)((W - 2) * frac);
  if (fw > 0) g->fillRect(X + 1, Y + 1, fw, H - 2, pal.text);
}

// --- native menu renderer + touch row rects ---------------------------------
int rowHitTest(int x, int y) {
  (void)x;
  for (int i = 0; i < s_rowCount; i++)
    if (y >= s_rows[i].y0 && y < s_rows[i].y1) return s_rows[i].idx;
  return -1;
}

int selectedRow() { return s_selectedRow; }

bool backHit(int x, int y) { return s_hasBack && x < BACK_W && y < BACK_H; }

void renderMenu(const MenuView& m) {
  lgfx::LovyanGFX* g = G();
  const Palette& pal = Theme::palette();
  g->fillScreen(pal.bg);
  g->setTextSize(1);
  s_rowCount = 0;
  s_selectedRow = -1;

  // Header — outline Back chip (sub-menus only) + title (white, not accent).
  s_hasBack = !m.showBrand;
  int titleX = 12;
  if (s_hasBack) {
    g->drawRoundRect(6, 6, 46, 28, 6, pal.muted);          // 1px outline
    g->drawLine(28, 20, 22, 20, pal.text);                 // thin left chevron
    g->drawLine(22, 20, 26, 16, pal.text);
    g->drawLine(22, 20, 26, 24, pal.text);
    titleX = 64;
  }
  g->setTextDatum(top_left);
  g->setFont(FONT_M);
  g->setTextColor(pal.text, pal.bg);
  g->drawString(m.showBrand ? "MindBox" : m.title, titleX, 10);
  if (m.statusWord[0]) {
    g->setTextDatum(top_right);
    g->setFont(FONT_S);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(m.statusWord, SCR_W - 12, 16);
  }
  if (m.clockStr[0]) {                         // local time top-right, above the status word (online only)
    g->setTextDatum(top_right);
    g->setFont(FONT_S);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(m.clockStr, SCR_W - 12, 2);
  }
  g->drawFastHLine(0, 40, SCR_W, pal.divider);

  // Full-screen duration spinner — dot-matrix number + dotted progress.
  if (m.durationEditor) {
    char b[8]; snprintf(b, sizeof(b), "%d", m.durationMin);
    DotFont::drawCentered(g, b, SCR_W / 2, 104, 4, 9, pal.text, pal.segment);
    g->setTextDatum(middle_center);
    g->setFont(FONT_M);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString("minutes", SCR_W / 2, 150);
    float fr = m.durationFrac < 0 ? 0 : (m.durationFrac > 1 ? 1 : m.durationFrac);
    const int N = 24, step = 9, x0 = (SCR_W - (N - 1) * step) / 2, by = 190;
    for (int i = 0; i < N; i++)
      g->fillCircle(x0 + i * step, by, 2,
                    ((float)i / (N - 1) <= fr) ? C_ACCENT : pal.divider);
    Panel::push();
    return;
  }

  int y = 52;
  if (m.infoLine[0]) {
    g->setTextDatum(top_center);
    g->setFont(FONT_S);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(m.infoLine, SCR_W / 2, 46);
    y = 70;
  }

  // Sparse rows: red-dot selection, thin grid line per row, monochrome glyphs.
  const int rowH = 40;
  for (uint8_t i = 0; i < m.rowCount && i < MENU_VISIBLE_ROWS; i++) {
    const MenuRow& r = m.rows[i];
    int ry = y + i * rowH;
    int rmid = ry + rowH / 2;
    bool sel = r.selected;
    uint16_t fg = sel ? pal.text : pal.muted;   // selected row brighter

    if (sel) g->fillCircle(14, rmid, 4, C_ACCENT);   // the one red dot

    int labelX = 30;
    if (r.icon != MI_NONE) {
      Icons::drawMenuIcon(g, r.icon, 42, rmid, fg);
      labelX = 62;
    }

    g->setTextDatum(middle_left);
    g->setFont(FONT_M);
    g->setTextColor(fg, pal.bg);
    g->drawString(r.label, labelX, rmid);

    int rightX = SCR_W - 18;
    if (r.chevron) {                       // thin drill-in chevron
      const int cxv = SCR_W - 20;
      g->drawLine(cxv - 3, rmid - 5, cxv + 3, rmid, fg);
      g->drawLine(cxv + 3, rmid, cxv - 3, rmid + 5, fg);
      rightX = SCR_W - 34;
    }
    if (r.hasValue) {
      g->setTextDatum(middle_right);
      g->setTextColor(pal.muted, pal.bg);
      g->drawString(r.value, rightX, rmid);
    }

    g->drawFastHLine(8, ry + rowH, SCR_W - 16, pal.divider);   // grid line

    if (sel) s_selectedRow = s_rowCount;
    s_rows[s_rowCount].y0  = ry;
    s_rows[s_rowCount].y1  = ry + rowH;
    s_rows[s_rowCount].idx = i;
    s_rowCount++;
  }

  if (m.accountEmail[0]) {
    g->setTextDatum(bottom_left);
    g->setFont(FONT_S);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(m.accountEmail, 12, SCR_H - 6);
  }

  Panel::push();
}

// --- agenda day page (ST_AGENDA pager: today + the week ahead) ----------------
// Kind accents: class = blue, exam = amber, study = red (the focus colour —
// study blocks are the ones that scheduled-auto-start a session).
static uint16_t agendaKindColor(uint8_t kind) {
  switch (kind) {
    case AGENDA_EXAM:  return C_ALERT;
    case AGENDA_STUDY: return C_FOCUS;
    default:           return C_LONG_BREAK;   // AGENDA_CLASS
  }
}

void renderAgenda(const AgendaItem* items, uint8_t count, int nowMin,
                  uint8_t dayIdx, const char* header, bool hasPrev, bool hasNext) {
  lgfx::LovyanGFX* g = G();
  const Palette& pal = Theme::palette();
  g->fillScreen(pal.bg);
  g->setTextSize(1);
  s_rowCount = 0; s_selectedRow = -1;

  // Header — same back-chip + title treatment as renderMenu (long-press = back).
  s_hasBack = true;
  g->drawRoundRect(6, 6, 46, 28, 6, pal.muted);
  g->drawLine(28, 20, 22, 20, pal.text);
  g->drawLine(22, 20, 26, 16, pal.text);
  g->drawLine(22, 20, 26, 24, pal.text);
  g->setTextDatum(top_left);
  g->setFont(FONT_M);
  g->setTextColor(pal.text, pal.bg);
  g->drawString((header && header[0]) ? header : "TODAY", 64, 10);
  // ‹ / › day-paging affordances (swipe changes day) — clear of the day-0
  // clock, which owns the very right edge.
  g->setTextDatum(top_center);
  g->setTextColor(pal.muted, pal.bg);
  if (hasPrev) g->drawString("<", SCR_W - 88, 10);
  if (hasNext) g->drawString(">", SCR_W - 64, 10);
  if (nowMin >= 0) {   // owner-local clock (the timezone the agenda is written in)
    char clk[8];
    snprintf(clk, sizeof(clk), "%02d:%02d", nowMin / 60, nowMin % 60);
    g->setTextDatum(top_right);
    g->setFont(FONT_S);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(clk, SCR_W - 12, 16);
  }
  g->drawFastHLine(0, 40, SCR_W, pal.divider);

  if (count == 0) {
    g->setTextDatum(middle_center);
    g->setFont(FONT_M);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(dayIdx == 0 ? "No plan today" : "Nothing planned", SCR_W / 2, SCR_H / 2);
    Panel::push();
    return;
  }

  // Items are server-sorted by startMin: the first block that hasn't ended yet
  // is "now" (if started) or "next" — the one row that gets the red dot.
  int hot = -1;
  if (nowMin >= 0)
    for (int i = 0; i < count; i++)
      if (nowMin < (int)items[i].endMin) { hot = i; break; }

  const int rowH = 30, y0 = 48;
  const int maxRows = (SCR_H - y0 - 10) / rowH;   // 6 rows on 240 px
  int first = 0;
  if (hot >= 0 && count > maxRows) {              // keep the hot row visible (one row of context above)
    first = hot - 1;
    if (first < 0) first = 0;
    if (first > count - maxRows) first = count - maxRows;
  }
  int shown = count - first;
  if (shown > maxRows) shown = maxRows;

  for (int i = 0; i < shown; i++) {
    const AgendaItem& it = items[first + i];
    int ry = y0 + i * rowH, rmid = ry + rowH / 2;
    bool isHot = (first + i) == hot;
    bool past  = nowMin >= 0 && (int)it.endMin <= nowMin;

    g->fillRect(10, ry + 4, 4, rowH - 8, past ? pal.divider : agendaKindColor(it.kind));

    char tbuf[16];
    snprintf(tbuf, sizeof(tbuf), "%02u:%02u-%02u:%02u",
             it.startMin / 60u, it.startMin % 60u, it.endMin / 60u, it.endMin % 60u);
    g->setTextDatum(middle_left);
    g->setFont(FONT_S);
    g->setTextColor(isHot ? pal.text : pal.muted, pal.bg);
    g->drawString(tbuf, 22, rmid);
    char tt[16];   // FONT_S fits ~15 title chars right of the time column
    strncpy(tt, it.title, sizeof(tt) - 1);
    tt[sizeof(tt) - 1] = 0;
    g->drawString(tt, 152, rmid);
    if (isHot) g->fillCircle(SCR_W - 14, rmid, 3, C_ACCENT);   // the one red dot: now / next

    g->drawFastHLine(8, ry + rowH, SCR_W - 16, pal.divider);
  }

  if (first + shown < count) {
    char more[12];
    snprintf(more, sizeof(more), "+%d more", count - first - shown);
    g->setTextDatum(bottom_right);
    g->setFont(FONT_S);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(more, SCR_W - 10, SCR_H - 2);
  }
  Panel::push();
}

// --- scheduled-start splash (ST_AUTOSTART) -----------------------------------
void renderAutoStart(const char* title, int secsLeft) {
  lgfx::LovyanGFX* g = G();
  const Palette& pal = Theme::palette();
  g->fillScreen(pal.bg);
  g->setTextSize(1);
  s_rowCount = 0; s_selectedRow = -1; s_hasBack = false;

  g->fillCircle(SCR_W / 2 - 92, 48, 4, C_ACCENT);   // the one red dot (matches sComplete)
  g->setTextDatum(middle_center);
  g->setFont(FONT_L);
  g->setTextColor(pal.text, pal.bg);
  g->drawString("Starting", SCR_W / 2 + 8, 48);

  const char* t = (title && title[0]) ? title : "study block";
  g->setFont(strlen(t) > 20 ? FONT_S : FONT_M);   // 23-char titles overflow FONT_M
  g->setTextColor(pal.muted, pal.bg);
  g->drawString(t, SCR_W / 2, 88);

  char b[8];
  snprintf(b, sizeof(b), "%d", secsLeft < 0 ? 0 : secsLeft);
  g->setFont(FONT_XL);
  g->setTextColor(pal.text, pal.bg);
  g->drawString(b, SCR_W / 2, 150);

  g->setFont(FONT_S);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString("tap to cancel", SCR_W / 2, 216);
  Panel::push();
}

// --- remote message / ring splash (ST_MESSAGE) --------------------------------
void renderMessage(const char* title, const char* body, int secsLeft) {
  lgfx::LovyanGFX* g = G();
  const Palette& pal = Theme::palette();
  g->fillScreen(pal.bg);
  g->setTextSize(1);
  s_rowCount = 0; s_selectedRow = -1; s_hasBack = false;

  const char* t = (title && title[0]) ? title : "Message";
  g->setTextDatum(middle_center);
  g->setFont(strlen(t) > 14 ? FONT_M : FONT_L);
  g->setTextColor(pal.text, pal.bg);
  g->drawString(t, SCR_W / 2, 56);

  // Body (<=47 chars): wrap onto two lines at the space nearest the middle so a
  // full-length remote message never runs off the panel.
  if (body && body[0]) {
    char b1[48], b2[48];
    strncpy(b1, body, sizeof(b1) - 1);
    b1[sizeof(b1) - 1] = 0;
    b2[0] = 0;
    size_t len = strlen(b1);
    if (len > 22) {
      int split = -1;
      for (int d = 0; d < (int)len / 2; d++) {          // nearest space to the middle
        int lo = (int)len / 2 - d, hi = (int)len / 2 + d;
        if (lo > 0 && b1[lo] == ' ') { split = lo; break; }
        if (hi < (int)len && b1[hi] == ' ') { split = hi; break; }
      }
      if (split > 0) {
        strncpy(b2, b1 + split + 1, sizeof(b2) - 1);
        b2[sizeof(b2) - 1] = 0;
        b1[split] = 0;
      }
    }
    g->setFont(FONT_M);
    g->setTextColor(pal.muted, pal.bg);
    g->drawString(b1, SCR_W / 2, b2[0] ? 108 : 118);
    if (b2[0]) g->drawString(b2, SCR_W / 2, 132);
  }

  char c[8];
  snprintf(c, sizeof(c), "%d", secsLeft < 0 ? 0 : secsLeft);
  g->setFont(FONT_M);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString(c, SCR_W / 2, 180);

  g->setFont(FONT_S);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString("tap to dismiss", SCR_W / 2, 216);
  Panel::push();
}

// --- post-focus homework quick-update (ST_HOMEWORK) ---------------------------
void renderHomework(const HwItem* items, uint8_t count, uint8_t sel) {
  lgfx::LovyanGFX* g = G();
  const Palette& pal = Theme::palette();
  g->fillScreen(pal.bg);
  g->setTextSize(1);
  s_rowCount = 0; s_selectedRow = -1; s_hasBack = false;

  g->setTextDatum(top_left);
  g->setFont(FONT_M);
  g->setTextColor(pal.text, pal.bg);
  g->drawString("Nice work!", 12, 8);
  g->setTextDatum(top_right);
  g->setFont(FONT_S);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString("update homework?", SCR_W - 12, 14);
  g->drawFastHLine(0, 36, SCR_W, pal.divider);

  // Rows: title + thin progress bar + pct — selected row gets the accent dot
  // (same language as renderMenu; swipe moves, tap = +25%).
  const int rowH = 46, y0 = 42;
  if (count > HW_MAX_ITEMS) count = HW_MAX_ITEMS;
  for (uint8_t i = 0; i < count; i++) {
    const HwItem& it = items[i];
    int ry = y0 + i * rowH;
    bool isSel = (sel == i);
    uint16_t fg = isSel ? pal.text : pal.muted;
    if (isSel) g->fillCircle(14, ry + 14, 4, C_ACCENT);

    g->setTextDatum(middle_left);
    g->setFont(FONT_M);
    g->setTextColor(fg, pal.bg);
    g->drawString(it.title, 30, ry + 14);

    char p[8];
    snprintf(p, sizeof(p), "%u%%", (unsigned)it.pct);
    g->setTextDatum(middle_right);
    g->setTextColor(it.pct >= 100 ? C_ACCENT : pal.muted, pal.bg);
    g->drawString(p, SCR_W - 14, ry + 14);

    int bw = SCR_W - 30 - 60;                       // bar under the title
    g->fillRect(30, ry + 30, bw, 6, pal.segment);
    int fw = bw * it.pct / 100;
    if (fw > 0) g->fillRect(30, ry + 30, fw, 6, C_ACCENT);
    g->drawFastHLine(8, ry + rowH - 2, SCR_W - 16, pal.divider);
  }

  // Skip row (sel == count) + the touch hint.
  {
    int ry = y0 + count * rowH;
    bool isSel = (sel >= count);
    if (isSel) g->fillCircle(14, ry + 14, 4, C_ACCENT);
    g->setTextDatum(middle_left);
    g->setFont(FONT_M);
    g->setTextColor(isSel ? pal.text : pal.muted, pal.bg);
    g->drawString("Skip", 30, ry + 14);
  }
  g->setTextDatum(bottom_center);
  g->setFont(FONT_S);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString("tap = +25%  hold = done", SCR_W / 2, SCR_H - 4);
  Panel::push();
}

// --- per-state screens ------------------------------------------------------
static void sPairing(const UiModel& m) {
  clear();
  if (m.paired) {
    center("PAIRED", 2, 1);
    String owner = Storage::ownerDisplayName();
    String email = Storage::ownerEmail();
    if (owner.length()) center(owner.c_str(), 16, 1);
    if (email.length()) {
      if (email.length() > 21) email = email.substring(0, 21);
      center(email.c_str(), owner.length() ? 28 : 16, 1);
    } else if (!owner.length()) {
      center("linked to account", 28, 1);
    }
  } else if (m.wifi && m.pairCode && m.pairCode[0]) {
    center("PAIR THIS BOX", 0, 1);
    center(m.pairCode, 18, 2);
    center("enter in MindBox app", 44, 1);
  } else {
    center("PAIR THIS BOX", 0, 1);
    char id[24];
    snprintf(id, sizeof(id), "id %s", (m.deviceId && m.deviceId[0]) ? m.deviceId : "?");
    center(id, 16, 1);
    center("connect Wi-Fi, then", 32, 1);
    center("pair in the app", 42, 1);
  }
  center("tap ok  hold = back", 56, 1);
  show();
}

// One "label .......... value" stat row + a thin grid line under it (mono).
static void statRow(lgfx::LovyanGFX* g, const Palette& pal, int y,
                    const char* label, const char* value) {
  g->setFont(FONT_M);
  g->setTextDatum(middle_left);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString(label, 40, y);
  g->setTextDatum(middle_right);
  g->setTextColor(pal.text, pal.bg);
  g->drawString(value, SCR_W - 40, y);
  g->drawFastHLine(40, y + 16, SCR_W - 80, pal.divider);
}

// Same row, but a lit/dim icon instead of a text label — for the sensor stats (temp/noise/away).
static void statRowIcon(lgfx::LovyanGFX* g, const Palette& pal, int y,
                        uint8_t icon, bool active, const char* value) {
  Icons::drawMenuIcon(g, icon, 48, y, active ? C_ACCENT : pal.muted);
  g->setFont(FONT_M);
  g->setTextDatum(middle_right);
  g->setTextColor(pal.text, pal.bg);
  g->drawString(value, SCR_W - 40, y);
  g->drawFastHLine(40, y + 16, SCR_W - 80, pal.divider);
}

static void sComplete(const UiModel& m) {
  lgfx::LovyanGFX* g = G();
  const Palette& pal = Theme::palette();
  g->fillScreen(pal.bg);

  g->fillCircle(SCR_W / 2 - 78, 40, 4, C_ACCENT);   // the one red dot
  g->setFont(FONT_L);
  g->setTextDatum(middle_center);
  g->setTextColor(pal.text, pal.bg);
  g->drawString(m.setComplete ? "set done" : "session done", SCR_W / 2 + 8, 40);

  char b[24];
  int y = 96, step = 32;

  if (m.setComplete) {
    snprintf(b, sizeof(b), "%d", m.setCycleTotal);
    statRow(g, pal, y, "cycles", b); y += step;
  } else {
    int tgt = m.targetSec / 60;
    snprintf(b, sizeof(b), "%dm / %dm", m.actualFocusMin, tgt > 0 ? tgt : m.durationMin);
    statRow(g, pal, y, "focus", b); y += step;
  }
  snprintf(b, sizeof(b), "%d", m.sessionBreaks);
  statRow(g, pal, y, "breaks", b); y += step;
  if (m.sessionInterf != INTERF_NONE) {
    statRow(g, pal, y, "interfere", interferenceLabel(m.sessionInterf)); y += step;
  }
#if HAS_PRESENCE
  snprintf(b, sizeof(b), "%d", m.sessionPresInt);
  statRowIcon(g, pal, y, MI_PRESENCE, m.sessionPresInt > 0, b); y += step;   // away icon lit if you stepped away
#endif
#if HAS_ANY_MIC
  if (m.sessionNoisePct >= 0) {
    snprintf(b, sizeof(b), "%d%%", m.sessionNoisePct);
    statRowIcon(g, pal, y, MI_NOISE, m.sessionNoisePct >= 50, b); y += step;   // noise icon lit when notably loud
  }
#endif
#if HAS_TEMP
  if (m.sessionTempC > -100.0f) {   // real reading (NaN compares false) -> show the temperature
    snprintf(b, sizeof(b), "%.0fC", m.sessionTempC);
    statRowIcon(g, pal, y, MI_TEMP, m.sessionTempHot, b); y += step;
  }
#endif
  Panel::push();
}

void render(const UiModel& m) {
  s_rowCount = 0;          // non-menu screens have no tappable rows
  s_selectedRow = -1;
  s_hasBack = false;
  switch (m.state) {
    case ST_BOOTING:  clear(); center("MindBox", 16, 2); center("starting...", 44, 1); show(); break;
    case ST_RUNNING:  TimerScreen::render(m); break;
#if USE_TOUCH
    case ST_PAUSED:   TimerScreen::render(m); break;   // paused timer w/ play + transport circles
#else
    case ST_PAUSED:   clear(); center("PAUSED", 6, 2);
                      center(pauseReasonLine(m.pauseReason), 30, 1); show(); break;
#endif
    case ST_COMPLETE: sComplete(m); break;
    case ST_LOGGING:  clear(); center("syncing...", 24, 1); show(); break;
    case ST_ERROR:    clear(); center("SENSOR FAULT", 12, 1); center("hold to reset", 40, 1); show(); break;
    case ST_PAIRING:  sPairing(m); break;
    // ST_IDLE / ST_RESUME / ST_CYCLE_OFFER render via renderMenu;
    // ST_DIAG / ST_WIFI_SETUP are drawn inline by StateMachine.
    default: break;
  }
}

} // namespace Display
