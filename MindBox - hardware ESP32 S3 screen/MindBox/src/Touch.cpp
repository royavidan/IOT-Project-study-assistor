#include "Touch.h"
#if USE_TOUCH
#include "Panel.h"
#include "Fonts.h"
#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <esp_task_wdt.h>

// ============================================================================
// Touch (input) — FT6336 capacitive controller read DIRECTLY over Arduino Wire
// (I2C port 0), the SAME bus as the VL53L1X ToF. Touch + ToF are then just two
// addresses on ONE I2C master (touch 0x38, ToF 0x29) — no two-master pad-sharing
// contention, which is what killed touch when the ToF was on a second master.
//
// LovyanGFX's own FT6336 touch driver is NOT used (it owns a separate I2C port);
// see Panel.* where it's removed. We read the raw registers ourselves and map them
// to screen coordinates with a one-time 4-corner calibration (persisted to NVS)
// that LEARNS the raw->screen transform — so it is correct for ANY panel rotation
// or mirror without hand-tuning. poll() classifies a tap vs a vertical drag on
// release, so dragging never triggers a select (same contract as before).
// ============================================================================

namespace Touch {

static const uint8_t FT_ADDR = TOUCH_I2C_ADDR;   // 0x38

// Learned raw->screen linear map. swapXY picks which raw axis feeds screen-X; the
// (r0,r1) pairs are the raw values at screen 0 and screen max (r0>r1 => mirrored).
struct Cal { uint8_t magic; uint8_t swapXY; int16_t xr0, xr1, yr0, yr1; };
static const uint8_t CAL_MAGIC = 0xC2;
static Cal s_cal = { 0, 0, 0, 4095, 0, 4095 };

static bool s_down = false;
static uint32_t s_downMs = 0;        // when the current press started (for long-press timing)
static bool s_longSent = false;      // long-press already delivered this press -> suppress the release tap
static int  s_downX = 0, s_downY = 0, s_lastX = 0, s_lastY = 0;
static const int DRAG_THRESH = 44;   // px of vertical travel => a drag (forgiving, so taps aren't misread)
static const uint32_t LONG_PRESS_MS = 500;  // finger held still this long => long-press (mapped to Back)
static bool s_rawMode = false;       // keyboard/raw-tap mode: every release is a TAP at the down point
                                     // (no drag, no long-press) so a keypress can't be eaten as a swipe

// ---- FT6336 raw read over Wire. Returns true if a finger is present; rx/ry = 12-bit native coords. ------
// Registers: 0x02 = touch count; point-1 X = (0x03[3:0]<<8)|0x04, Y = (0x05[3:0]<<8)|0x06.
static bool ftReadRaw(int& rx, int& ry) {
  Wire.beginTransmission(FT_ADDR);
  Wire.write((uint8_t)0x02);
  if (Wire.endTransmission(false) != 0) return false;          // repeated-start read
  if (Wire.requestFrom((int)FT_ADDR, 5) != 5) return false;
  uint8_t n  = Wire.read() & 0x0F;   // 0x02 TD_STATUS (number of points)
  uint8_t xh = Wire.read();          // 0x03
  uint8_t xl = Wire.read();          // 0x04
  uint8_t yh = Wire.read();          // 0x05
  uint8_t yl = Wire.read();          // 0x06
  if (n == 0 || n > 2) return false; // no finger (or a glitch — ignore)
  rx = ((xh & 0x0F) << 8) | xl;
  ry = ((yh & 0x0F) << 8) | yl;
  return true;
}

// Apply the learned calibration: raw native coords -> screen coords (clamped to the panel).
static void rawToScreen(int rx, int ry, int& sx, int& sy) {
  int ax = s_cal.swapXY ? ry : rx;            // raw axis feeding screen-X
  int ay = s_cal.swapXY ? rx : ry;            // raw axis feeding screen-Y
  long dx = (long)s_cal.xr1 - s_cal.xr0; if (dx == 0) dx = 1;
  long dy = (long)s_cal.yr1 - s_cal.yr0; if (dy == 0) dy = 1;
  sx = (int)(((long)(ax - s_cal.xr0) * (SCR_W - 1)) / dx);
  sy = (int)(((long)(ay - s_cal.yr0) * (SCR_H - 1)) / dy);
  if (sx < 0) sx = 0; else if (sx >= SCR_W) sx = SCR_W - 1;
  if (sy < 0) sy = 0; else if (sy >= SCR_H) sy = SCR_H - 1;
}

static bool loadCal() {
  Preferences p; bool ok = false;
  if (p.begin("ftcal", true)) {
    if (p.getBytesLength("cal") == sizeof(Cal)) {
      p.getBytes("cal", &s_cal, sizeof(Cal));
      ok = (s_cal.magic == CAL_MAGIC);
    }
    p.end();
  }
  return ok;
}
static void saveCal() {
  Preferences p;
  if (p.begin("ftcal", false)) { p.putBytes("cal", &s_cal, sizeof(Cal)); p.end(); }
}

// Wait for one clean tap and return a STABLE raw coord for it. We collect every raw sample while the
// finger is held, then average the steady MIDDLE — dropping the first few (finger still settling) and
// the last few (the capacitive centroid rolls as the finger lifts). Returning the single last-sample
// baked that release-roll into the calibration, which showed up as the keyboard being offset.
// Blocking is fine (calibration only: before the watchdog is armed at boot, or with it removed on a long-press).
static bool waitCornerRaw(int& rx, int& ry) {
  int a = 0, b = 0; bool seen = false;
  uint32_t t0 = millis();
  while (millis() - t0 < 15000) {                 // wait for finger down
    if (ftReadRaw(a, b)) { seen = true; break; }
    delay(8);
  }
  if (!seen) return false;
  static const int CAP = 120;
  int xs[CAP], ys[CAP]; int n = 0;
  t0 = millis();
  while (millis() - t0 < 15000) {                 // sample continuously until release
    int r1, r2;
    if (!ftReadRaw(r1, r2)) break;
    if (n < CAP) { xs[n] = r1; ys[n] = r2; n++; }
    delay(8);
  }
  if (n == 0) return false;
  int lo = (n > 10) ? 3 : 0;                      // drop settle (head) + release-roll (tail)
  int hi = (n > 10) ? n - 3 : n;
  long sx = 0, sy = 0; int cnt = 0;
  for (int i = lo; i < hi; i++) { sx += xs[i]; sy += ys[i]; cnt++; }
  rx = (int)(sx / cnt); ry = (int)(sy / cnt);     // cnt >= 1 always (hi > lo for any n >= 1)
  return true;
}

// Round a float to int16 without pulling in <math.h> (values here are raw 12-bit coords +/- a margin).
static int16_t r16(float v) { return (int16_t)(v >= 0 ? v + 0.5f : v - 0.5f); }

void calibrate() {
  struct P { int rx, ry; } c[4];
  const int cxp[4] = { 14, SCR_W - 14, SCR_W - 14, 14 };   // TL, TR, BR, BL
  const int cyp[4] = { 14, 14, SCR_H - 14, SCR_H - 14 };
  for (int i = 0; i < 4; i++) {
    lcd.fillScreen(TFT_BLACK);
    lcd.setTextColor(TFT_WHITE, TFT_BLACK);
    lcd.setTextDatum(middle_center);
    lcd.setFont(FONT_M);
    lcd.drawString("Tap the dot", SCR_W / 2, SCR_H / 2);
    lcd.fillCircle(cxp[i], cyp[i], 7, TFT_WHITE);
    delay(350);
    if (!waitCornerRaw(c[i].rx, c[i].ry)) return;   // timeout -> keep the previous calibration
    delay(300);                                      // debounce before the next corner
  }
  // Detect axis swap: which raw axis varies more moving horizontally (left corners TL,BL vs right TR,BR).
  long hX = labs((long)c[1].rx + c[2].rx - c[0].rx - c[3].rx);
  long hY = labs((long)c[1].ry + c[2].ry - c[0].ry - c[3].ry);
  s_cal.swapXY = (hY > hX) ? 1 : 0;
  int axv[4], ayv[4];
  for (int i = 0; i < 4; i++) { axv[i] = s_cal.swapXY ? c[i].ry : c[i].rx;
                                ayv[i] = s_cal.swapXY ? c[i].rx : c[i].ry; }
  float xL = (axv[0] + axv[3]) / 2.0f;   // raw at the LEFT   dots (screen-x = 14)
  float xR = (axv[1] + axv[2]) / 2.0f;   // raw at the RIGHT  dots (screen-x = SCR_W-14)
  float yT = (ayv[0] + ayv[1]) / 2.0f;   // raw at the TOP    dots (screen-y = 14)
  float yB = (ayv[2] + ayv[3]) / 2.0f;   // raw at the BOTTOM dots (screen-y = SCR_H-14)
  // The corner dots are inset 14px from the edges. Extrapolate the linear map out to the true
  // 0..max screen edges so they land exactly — the old code stored the inset raw values AS the
  // 0/max references, baking in a ~10-14px stretch+offset (part of the "keyboard is off" drift).
  float rppx = (xR - xL) / (float)(SCR_W - 28);   // raw per screen-pixel, X (span between the dots)
  float rppy = (yB - yT) / (float)(SCR_H - 28);   // raw per screen-pixel, Y
  s_cal.xr0 = r16(xL - 14.0f * rppx);   // raw at screen-x = 0
  s_cal.xr1 = r16(xR + 13.0f * rppx);   // raw at screen-x = SCR_W-1 (right dot is 13px from the edge)
  s_cal.yr0 = r16(yT - 14.0f * rppy);   // raw at screen-y = 0
  s_cal.yr1 = r16(yB + 13.0f * rppy);   // raw at screen-y = SCR_H-1 (bottom dot is 13px from the edge)
  s_cal.magic = CAL_MAGIC;
  saveCal();
  Serial.printf("[touch] calibrated swap=%u xr0=%d xr1=%d yr0=%d yr1=%d\n",
                s_cal.swapXY, s_cal.xr0, s_cal.xr1, s_cal.yr0, s_cal.yr1);
  lcd.fillScreen(TFT_BLACK);
}

void begin() {
  Wire.begin(PIN_TOUCH_SDA, PIN_TOUCH_SCL);   // shared I2C bus (the ToF reuses this same Wire)
  Wire.setClock(TOUCH_FREQ);
  delay(10);
  if (!loadCal()) calibrate();                // first boot (or wiped NVS) -> run the corner calibration
}

void setRawMode(bool on) { s_rawMode = on; }

// Live touch probe: draws a crosshair + dot at the MAPPED screen point of wherever you touch, and
// prints raw + mapped coords. If the dot doesn't sit under your finger, the calibration is wrong
// (run calibrate()). Blocking ~12s, like the button live-test; the net task keeps the WDT fed, and
// we also reset it here in case the loop task is subscribed.
void diagnose() {
  Serial.println();
  Serial.println("[touch] LIVE probe — drag your finger; the red dot is where it maps. ~12s.");
  Serial.printf("[touch] cal: swap=%u xr0=%d xr1=%d yr0=%d yr1=%d  (screen %dx%d)\n",
                s_cal.swapXY, s_cal.xr0, s_cal.xr1, s_cal.yr0, s_cal.yr1, SCR_W, SCR_H);
  if (s_cal.magic != CAL_MAGIC || (s_cal.xr0 == 0 && s_cal.xr1 == 4095))
    Serial.println("[touch] ** calibration is DEFAULT/unset — run 'k' (or long-press BOOT) to calibrate. **");
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.setTextDatum(top_left);
  lcd.setFont(FONT_S);
  uint32_t end = millis() + 12000, lastPrint = 0;
  while ((int32_t)(millis() - end) < 0) {
    esp_task_wdt_reset();
    int rx, ry;
    if (ftReadRaw(rx, ry)) {
      int sx, sy; rawToScreen(rx, ry, sx, sy);
      lcd.fillScreen(TFT_BLACK);
      lcd.drawFastHLine(0, sy, SCR_W, TFT_GREEN);
      lcd.drawFastVLine(sx, 0, SCR_H, TFT_GREEN);
      lcd.fillCircle(sx, sy, 5, TFT_RED);
      char b[48];
      snprintf(b, sizeof(b), "raw %d,%d -> scr %d,%d", rx, ry, sx, sy);
      lcd.setTextColor(TFT_WHITE, TFT_BLACK);
      lcd.drawString(b, 6, 6);
      if (millis() - lastPrint > 120) { lastPrint = millis();
        Serial.printf("[touch] raw=%d,%d  screen=%d,%d\n", rx, ry, sx, sy); }
    }
    delay(15);
  }
  lcd.fillScreen(TFT_BLACK);
  Serial.println("[touch] probe done. Dot not under your finger -> run 'k' (or long-press BOOT) to recalibrate.");
}

Gesture poll(int& x, int& y) {
  int rx, ry;
  bool touched = ftReadRaw(rx, ry);
  int sx = 0, sy = 0;
  if (touched) rawToScreen(rx, ry, sx, sy);

  if (touched) {
    if (!s_down) { s_down = true; s_downMs = millis(); s_longSent = false;
                   s_downX = sx; s_downY = sy; s_lastX = sx; s_lastY = sy; }
    // Accept only plausible motion — a >100px jump between samples is a glitch, not a finger.
    else if (abs(sx - s_lastX) < 100 && abs(sy - s_lastY) < 100) { s_lastX = sx; s_lastY = sy; }

    // Long-press: a finger held STILL (not dragging) past LONG_PRESS_MS fires once, mid-hold.
    // If it has already wandered past the drag threshold it's a scroll, never a long-press.
    // Suppressed in raw mode: the keyboard wants exactly one tap-on-release per press.
    if (!s_rawMode && !s_longSent &&
        abs(s_lastX - s_downX) <= DRAG_THRESH && abs(s_lastY - s_downY) <= DRAG_THRESH &&
        (millis() - s_downMs) >= LONG_PRESS_MS) {
      s_longSent = true;
      x = s_downX; y = s_downY;
      return G_LONG_PRESS;
    }
    return G_NONE;                       // otherwise wait for release before deciding
  }

  if (s_down) {                          // released -> classify
    s_down = false;
    if (s_longSent) return G_NONE;       // long-press already delivered; the release is a no-op
    if (s_rawMode) { x = s_downX; y = s_downY; return G_TAP; }  // keyboard: always a tap where the finger landed
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
