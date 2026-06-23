#include "Touch.h"
#if USE_TOUCH
#include "Panel.h"
#include "Fonts.h"
#include <Arduino.h>
#include <Preferences.h>

// Capacitive FT6336 reports near-screen coordinates; a one-time corner
// calibration (persisted to NVS) corrects any residual offset/rotation and is
// re-applied every boot. Long-press BOOT re-runs it. poll() classifies a touch
// as a TAP or a vertical DRAG on release, so dragging never triggers a select.

namespace Touch {

static bool s_down = false;
static int  s_downX = 0, s_downY = 0, s_lastX = 0, s_lastY = 0;
static const int    DRAG_THRESH = 24;            // px of vertical travel => a drag
static const size_t CAL_BYTES = sizeof(uint16_t) * 8;

static bool loadCal(uint16_t* cal) {
  Preferences p;
  bool ok = false;
  if (p.begin("touchcal", true)) {
    if (p.getBytesLength("cal") == CAL_BYTES) { p.getBytes("cal", cal, CAL_BYTES); ok = true; }
    p.end();
  }
  return ok;
}

static void saveCal(const uint16_t* cal) {
  Preferences p;
  if (p.begin("touchcal", false)) { p.putBytes("cal", cal, CAL_BYTES); p.end(); }
}

void calibrate() {
  uint16_t cal[8];
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.setTextDatum(middle_center);
  lcd.setFont(FONT_M);
  lcd.drawString("Touch the corners", lcd.width() / 2, lcd.height() / 2);
  delay(700);
  lcd.calibrateTouch(cal, TFT_WHITE, TFT_BLACK, 25);  // measures + applies
  saveCal(cal);
  Serial.print(F("[touch] calibrated: "));
  for (int i = 0; i < 8; i++) { Serial.print(cal[i]); Serial.print(' '); }
  Serial.println();
}

void begin() {
  uint16_t cal[8];
  if (loadCal(cal)) lcd.setTouchCalibrate(cal);
  else              calibrate();
}

Gesture poll(int& x, int& y) {
  int32_t tx, ty;
  bool touched = lcd.getTouch(&tx, &ty);

  if (touched) {
    if (!s_down) { s_down = true; s_downX = tx; s_downY = ty; }
    s_lastX = tx; s_lastY = ty;
    return G_NONE;                       // wait for release before deciding
  }

  if (s_down) {                          // released -> classify
    s_down = false;
    int dy = s_lastY - s_downY;
    int dx = s_lastX - s_downX;
    if (abs(dy) > DRAG_THRESH && abs(dy) >= abs(dx)) {
      x = s_lastX; y = s_lastY;
      return dy < 0 ? G_DRAG_UP : G_DRAG_DOWN;   // finger up = advance the list
    }
    x = s_downX; y = s_downY;            // tap = where the finger landed
    return G_TAP;
  }
  return G_NONE;
}

} // namespace Touch
#endif
