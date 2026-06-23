#include "Inputs.h"
#include "config.h"
#include <Arduino.h>
#if HAS_ENCODER
#include <AiEsp32RotaryEncoder.h>
#endif
#if USE_TOUCH
#include "Touch.h"
#include "Display.h"
#include "TimerScreen.h"
#endif

// ============================================================================
// Inputs (S3) — produces the same rotationDir()/button() the Menu/StateMachine
// expect, from EITHER a KY-040 encoder (HAS_ENCODER) and/or the touchscreen.
//
// Touch is mapped to synthetic encoder/button events via screen zones (no menu
// cursor knowledge needed, so Menu/StateMachine stay untouched):
//   top-right corner -> back (2)   top third -> up (-1)
//   bottom third     -> down (+1)  middle    -> select (1)
// ============================================================================

static bool s_rotated = false, s_clicked = false;
static int  s_button = 0;
static int  s_minutes = DUR_DEFAULT_MIN;
static int  s_rotDir = 0;
static InputMode s_mode = INPUT_MENU;
static bool s_sidePressed = false;
static bool s_stuckLow = false;
#if USE_TOUCH
static bool s_timerScreen = false;             // bare RUNNING/PAUSED timer is showing
static int  s_timerAction = TimerScreen::TA_NONE; // latched transport action this tick
static bool s_rawTouch    = false;             // on-screen keyboard: latch raw taps
static bool s_tapped      = false;
static int  s_tapX = 0, s_tapY = 0;
#endif

#if HAS_ENCODER
static AiEsp32RotaryEncoder enc(PIN_ENC_CLK, PIN_ENC_DT, PIN_ENC_SW, -1, 4);
static int  s_lastEnc = 0;
static void IRAM_ATTR isr() { enc.readEncoder_ISR(); }
#endif

static bool sideIsPressed(int raw) {
#if BTN_ACTIVE_LOW
  return raw == LOW;
#else
  return raw == HIGH;
#endif
}

namespace Inputs {

void init() {
#if BTN_ACTIVE_LOW
  pinMode(PIN_BUTTON, INPUT_PULLUP);
#else
  pinMode(PIN_BUTTON, INPUT_PULLDOWN);
#endif
#if USE_SPDT_TOGGLE
  pinMode(PIN_SPDT, INPUT_PULLUP);
#endif
#if HAS_ENCODER
  enc.begin();
  enc.setup(isr);
  enc.setBoundaries(-512, 512, false);
  enc.setAcceleration(0);
  s_lastEnc = 0;
  enc.setEncoderValue(0);
#endif
  delay(20);
#if BTN_ACTIVE_LOW
  // A wired tact at rest reads HIGH; LOW means shorted/miswired -> disable it.
  // On the bare S3 board (no side button) the pull-up keeps this HIGH.
  if (digitalRead(PIN_BUTTON) == LOW) s_stuckLow = true;
#endif
#if USE_TOUCH
  Touch::begin();   // apply saved touch calibration, or run it once
#endif
}

void setInputMode(InputMode m) {
  s_mode = m;
#if HAS_ENCODER
  if (m == INPUT_MENU) {
    enc.setBoundaries(-512, 512, false);
    s_lastEnc = enc.readEncoder();
  } else {
    enc.setBoundaries(DUR_MIN_MIN / DUR_STEP_MIN, DUR_MAX_MIN / DUR_STEP_MIN, false);
    enc.setEncoderValue(s_minutes / DUR_STEP_MIN);
    s_lastEnc = enc.readEncoder();
  }
#endif
}

// Side tact: short tap on release = select; hold >= BTN_LONG_MS = back.
static void pollSideButton() {
  if (s_stuckLow) { s_sidePressed = false; return; }

  static int      stableRaw = -1;
  static int      lastRaw = -1;
  static uint32_t debounceAt = 0;
  static uint32_t pressAt = 0;
  static bool     longSent = false;

  int raw = digitalRead(PIN_BUTTON);
  if (raw != lastRaw) { lastRaw = raw; debounceAt = millis(); }

  if ((int32_t)(millis() - debounceAt) >= (int32_t)BTN_DEBOUNCE_MS) {
    if (raw != stableRaw) {
      bool was = (stableRaw >= 0) ? sideIsPressed(stableRaw) : false;
      stableRaw = raw;
      bool now = sideIsPressed(stableRaw);
      s_sidePressed = now;
      if (now && !was) { pressAt = millis(); longSent = false; }
      else if (!now && was) {
        if (!longSent && (millis() - pressAt) >= BTN_SHORT_MIN_MS) s_button = 1;
      }
    } else {
      s_sidePressed = sideIsPressed(stableRaw);
    }
  }
  if (s_sidePressed && !longSent && (millis() - pressAt) >= BTN_LONG_MS) {
    s_button = 2; longSent = true;
  }
}

#if USE_TOUCH
static void pollTouch() {
  int x, y;
  Touch::Gesture g = Touch::poll(x, y);
  if (g == Touch::G_NONE) return;

  // Raw-tap mode (keyboard): latch the tap point; swipes still scroll.
  if (s_rawTouch) {
    if (g == Touch::G_TAP) { s_tapped = true; s_tapX = x; s_tapY = y; }
    else if (g == Touch::G_DRAG_UP)   { s_rotDir =  1; s_rotated = true; }
    else if (g == Touch::G_DRAG_DOWN) { s_rotDir = -1; s_rotated = true; }
    return;
  }

  // On the bare timer screen, a tap on a control circle dispatches directly
  // (transport or the gear=options button); swipes and empty-space taps do
  // nothing, so a near-miss can't accidentally open the options overlay.
  if (s_timerScreen) {
    if (g != Touch::G_TAP) return;
    int ta = TimerScreen::hitTest(x, y);
    if (ta != TimerScreen::TA_NONE) s_timerAction = ta;
    return;
  }

  // Swipe = move the highlight (scroll / value step); never selects.
  if (g == Touch::G_DRAG_UP)   { s_rotDir =  1; s_rotated = true; return; }
  if (g == Touch::G_DRAG_DOWN) { s_rotDir = -1; s_rotated = true; return; }

  // --- tap ---
  if (Display::backHit(x, y)) { s_button = 2; return; }   // visible Back button
  s_button = 1;   // one tap anywhere = enter the currently-highlighted row
}
#endif

void poll() {
  s_button = 0;
  s_rotDir = 0;
  s_rotated = false;
#if USE_TOUCH
  s_timerAction = TimerScreen::TA_NONE;
  s_tapped = false;
#endif
#if HAS_ENCODER
  s_rotated = enc.encoderChanged();
  if (s_rotated) {
    int v = enc.readEncoder();
    if (v > s_lastEnc)      s_rotDir = 1;
    else if (v < s_lastEnc) s_rotDir = -1;
    s_lastEnc = v;
    if (s_mode == INPUT_DURATION) s_minutes = v * DUR_STEP_MIN;
  }
  s_clicked = enc.isEncoderButtonClicked();
#else
  s_clicked = false;
#endif
  pollSideButton();
#if USE_TOUCH
  if (s_button == 0 && s_rotDir == 0) pollTouch();
#endif
}

void setTimerScreenActive(bool on) {
#if USE_TOUCH
  s_timerScreen = on;
#else
  (void)on;
#endif
}
int timerAction() {
#if USE_TOUCH
  return s_timerAction;
#else
  return -1;   // TimerScreen::TA_NONE (header not included in the no-touch build)
#endif
}

void setRawTouchActive(bool on) {
#if USE_TOUCH
  s_rawTouch = on;
  if (!on) s_tapped = false;
#else
  (void)on;
#endif
}
bool tapped() {
#if USE_TOUCH
  return s_tapped;
#else
  return false;
#endif
}
int tapX() {
#if USE_TOUCH
  return s_tapX;
#else
  return 0;
#endif
}
int tapY() {
#if USE_TOUCH
  return s_tapY;
#else
  return 0;
#endif
}

bool rotated()     { return s_rotated; }
int  rotationDir() { return s_rotDir; }
int  minutes()     { return s_minutes; }
void setMinutes(int m) {
  if (m < DUR_MIN_MIN) m = DUR_MIN_MIN;
  if (m > DUR_MAX_MIN) m = DUR_MAX_MIN;
  s_minutes = m;
#if HAS_ENCODER
  enc.setEncoderValue(m / DUR_STEP_MIN);
#endif
}
bool knobClicked() { return s_clicked; }
int  button()      { return s_button; }
bool sidePressed() { return s_sidePressed; }
int  sideRaw()     { return digitalRead(PIN_BUTTON); }
bool sideFault()   { return s_stuckLow; }

bool spdtPresentWork() {
#if USE_SPDT_TOGGLE
  return digitalRead(PIN_SPDT) == LOW;
#else
  return true;
#endif
}

} // namespace Inputs
