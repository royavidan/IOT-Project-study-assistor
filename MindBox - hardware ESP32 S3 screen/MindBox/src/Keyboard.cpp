#include "Keyboard.h"
#if USE_TOUCH
#include "Panel.h"
#include "Theme.h"
#include "Fonts.h"
#include <Arduino.h>

namespace Keyboard {

enum Act { KCHAR, KSHIFT, KLAYER, KBKSP, KSPACE, KDONE, KCANCEL };
struct Key { char label[6]; uint8_t act; char ch; int x, y, w, h; };

static char  s_buf[65];
static int   s_len    = 0;
static char  s_title[34];
static bool  s_masked = false;
static bool  s_shift  = false;
static bool  s_sym    = false;   // symbols/numbers layer
static bool  s_done   = false;
static bool  s_cancel = false;
static bool  s_dirty  = true;

// Letter rows (lowercase) and the symbols layer.
static const char* ROWS_ABC[3] = { "qwertyuiop", "asdfghjkl", "zxcvbnm" };
static const char* ROWS_SYM[3] = { "1234567890", "@#$_&-+()", ".,?!'/:;" };

static const int KH = 34, Y0 = 58, GAP = 4;

// Build the live key set (geometry + actions) shared by render() and handleTap().
static int buildKeys(Key out[]) {
  int n = 0;
  const char** rows = s_sym ? ROWS_SYM : ROWS_ABC;
  for (int r = 0; r < 3; r++) {
    int len = strlen(rows[r]);
    int kw = 30, total = len * kw, x0 = (SCR_W - total) / 2;
    int y = Y0 + r * (KH + GAP);
    for (int i = 0; i < len; i++) {
      Key& k = out[n++];
      char c = rows[r][i];
      if (s_shift && !s_sym && c >= 'a' && c <= 'z') c -= 32;
      k.label[0] = c; k.label[1] = 0;
      k.act = KCHAR; k.ch = c;
      k.x = x0 + i * kw; k.y = y; k.w = kw - 2; k.h = KH;
    }
  }
  // Function row: shift · 123/abc · space · bksp · done · cancel (6 equal keys).
  int y = Y0 + 3 * (KH + GAP);
  int fw = 52, x0 = (SCR_W - fw * 6) / 2;
  struct F { const char* l; uint8_t a; } fr[6] = {
    { s_shift ? "^*" : "^", KSHIFT }, { s_sym ? "abc" : "123", KLAYER },
    { "spc", KSPACE }, { "<x", KBKSP }, { "OK", KDONE }, { "x", KCANCEL }
  };
  for (int i = 0; i < 6; i++) {
    Key& k = out[n++];
    strncpy(k.label, fr[i].l, sizeof(k.label) - 1); k.label[sizeof(k.label) - 1] = 0;
    k.act = fr[i].a; k.ch = 0;
    k.x = x0 + i * fw; k.y = y; k.w = fw - 2; k.h = KH;
  }
  return n;
}

void begin(const char* title, bool masked) {
  s_buf[0] = 0; s_len = 0;
  strncpy(s_title, title ? title : "", sizeof(s_title) - 1);
  s_title[sizeof(s_title) - 1] = 0;
  s_masked = masked;
  s_shift = s_sym = s_done = s_cancel = false;
  s_dirty = true;
}

void handleTap(int x, int y) {
  Key keys[48];
  int n = buildKeys(keys);
  for (int i = 0; i < n; i++) {
    const Key& k = keys[i];
    if (x < k.x || x >= k.x + k.w || y < k.y || y >= k.y + k.h) continue;
    switch (k.act) {
      case KCHAR:  if (s_len < (int)sizeof(s_buf) - 1) { s_buf[s_len++] = k.ch; s_buf[s_len] = 0; }
                   if (s_shift && !s_sym) s_shift = false;   // one-shot shift
                   break;
      case KSHIFT: s_shift = !s_shift; break;
      case KLAYER: s_sym = !s_sym; s_shift = false; break;
      case KBKSP:  if (s_len > 0) s_buf[--s_len] = 0; break;
      case KSPACE: if (s_len < (int)sizeof(s_buf) - 1) { s_buf[s_len++] = ' '; s_buf[s_len] = 0; } break;
      case KDONE:  s_done = true; break;
      case KCANCEL: s_cancel = true; break;
    }
    s_dirty = true;
    return;
  }
}

void render() {
  lgfx::LovyanGFX* g = Panel::canvas();
  const Palette& pal = Theme::palette();
  g->fillScreen(pal.bg);

  // Title + entry field (masked for passwords).
  g->setTextDatum(top_left);
  g->setFont(FONT_S);
  g->setTextColor(pal.muted, pal.bg);
  g->drawString(s_title, 8, 6);

  char shown[66];
  if (s_masked) { int i = 0; for (; i < s_len && i < 64; i++) shown[i] = '*'; shown[i] = 0; }
  else          { strncpy(shown, s_buf, sizeof(shown) - 1); shown[sizeof(shown) - 1] = 0; }
  g->drawRect(8, 26, SCR_W - 16, 24, pal.divider);
  g->setFont(FONT_M);
  g->setTextColor(pal.text, pal.bg);
  g->setTextDatum(middle_left);
  g->drawString(shown, 14, 38);

  Key keys[48];
  int n = buildKeys(keys);
  g->setFont(FONT_S);
  for (int i = 0; i < n; i++) {
    const Key& k = keys[i];
    bool accent = (k.act == KDONE);
    bool active = (k.act == KSHIFT && s_shift) || (k.act == KLAYER && s_sym);
    uint16_t edge = accent ? C_ACCENT : (active ? pal.text : pal.divider);
    g->drawRoundRect(k.x, k.y, k.w, k.h, 4, edge);
    g->setTextDatum(middle_center);
    g->setTextColor(accent ? C_ACCENT : pal.text, pal.bg);
    g->drawString(k.label, k.x + k.w / 2, k.y + k.h / 2);
  }
  Panel::push();
  s_dirty = false;
}

const char* text()  { return s_buf; }
bool done()         { return s_done; }
bool cancelled()    { return s_cancel; }
bool dirty()        { return s_dirty; }

} // namespace Keyboard
#endif
