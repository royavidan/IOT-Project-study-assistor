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
static const int    DRAG_THRESH = 44;            // px of vertical travel => a drag (was 24 — too low;
                                                 // a finger-sized tap easily drifts >24px and got
                                                 // misread as a scroll. Higher = taps are forgiving.)
static const size_t CAL_BYTES = sizeof(uint16_t) * 8;
// FT6336 reads off-screen by more than this are corrupted I2C samples, not fingers — they're ignored.
static const int    TOUCH_OOB_MARGIN = 12;

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

  // A corrupted/contended I2C read surfaces as a "touch" with wild coordinates (e.g. (-3817,4963)) —
  // the calibration transform applied to a failed read. Drop anything well off-screen so it can neither
  // start nor end a touch; a genuine release still reads as not-touched and classifies normally below.
  if (touched && (tx < -TOUCH_OOB_MARGIN || tx >= SCR_W + TOUCH_OOB_MARGIN ||
                  ty < -TOUCH_OOB_MARGIN || ty >= SCR_H + TOUCH_OOB_MARGIN)) {
    return G_NONE;
  }

  if (touched) {
    if (tx < 0) tx = 0; else if (tx >= SCR_W) tx = SCR_W - 1;   // clamp a legit edge read into range
    if (ty < 0) ty = 0; else if (ty >= SCR_H) ty = SCR_H - 1;
    if (!s_down) { s_down = true; s_downX = tx; s_downY = ty; s_lastX = tx; s_lastY = ty; }
    // Accept only plausible motion. Polls are a few ms apart, so a >100px jump between samples is a
    // controller glitch, not a finger — ignore it so one bad read can't fake a drag on a held tap.
    else if (abs((int)tx - s_lastX) < 100 && abs((int)ty - s_lastY) < 100) { s_lastX = tx; s_lastY = ty; }
    return G_NONE;                       // wait for release before deciding
  }

  if (s_down) {                          // released -> classify
    s_down = false;
    int dy = s_lastY - s_downY;
    int dx = s_lastX - s_downX;
    Gesture g;
    if (abs(dy) > DRAG_THRESH && abs(dy) >= abs(dx)) {
      x = s_lastX; y = s_lastY; g = (dy < 0) ? G_DRAG_UP : G_DRAG_DOWN;   // finger up = advance the list
    } else {
      x = s_downX; y = s_downY; g = G_TAP;                                // tap = where the finger landed
    }
    return g;
  }
  return G_NONE;
}

} // namespace Touch
#endif
