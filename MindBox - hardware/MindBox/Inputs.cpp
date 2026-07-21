#include "Inputs.h"
#include "config.h"
#include <AiEsp32RotaryEncoder.h>

static AiEsp32RotaryEncoder enc(PIN_ENC_CLK, PIN_ENC_DT, PIN_ENC_SW, -1, 4);
static bool s_rotated = false, s_clicked = false;
static int  s_button = 0;
static int  s_minutes = DUR_DEFAULT_MIN;
static int  s_rotDir = 0;
static int  s_lastEnc = 0;
static InputMode s_mode = INPUT_MENU;
static bool s_sidePressed = false;
static bool s_stuckLow = false;

static void IRAM_ATTR isr() { enc.readEncoder_ISR(); }

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
  enc.begin();
  enc.setup(isr);
  enc.setBoundaries(-512, 512, false);
  enc.setAcceleration(0);
  s_lastEnc = 0;
  enc.setEncoderValue(0);

  // At rest (pull-up) the pin must read HIGH. LOW = shorted / wrong tact pins.
  delay(20);
#if BTN_ACTIVE_LOW
  if (digitalRead(PIN_BUTTON) == LOW) {
    s_stuckLow = true;
    Serial.println();
    Serial.println("[WARN] GPIO4 stuck LOW at rest — button ignored.");
    Serial.println("       6x6 tact: wire DIAGONAL pins only (not same-side pair).");
    Serial.println("       Open: raw=1  Pressed: raw=0. Type 'b' in Serial for live test.");
    Serial.println();
  }
#endif
}

void setInputMode(InputMode m) {
  s_mode = m;
  if (m == INPUT_MENU) {
    enc.setBoundaries(-512, 512, false);
    s_lastEnc = enc.readEncoder();
  } else {
    enc.setBoundaries(DUR_MIN_MIN / DUR_STEP_MIN, DUR_MAX_MIN / DUR_STEP_MIN, false);
    enc.setEncoderValue(s_minutes / DUR_STEP_MIN);
    s_lastEnc = enc.readEncoder();
  }
}

// Side tact (GPIO 4): short tap on release = select; hold >= BTN_LONG_MS = back.
static void pollSideButton() {
  if (s_stuckLow) { s_sidePressed = false; return; }

  static int     stableRaw = -1;
  static int     lastRaw = -1;
  static uint32_t debounceAt = 0;
  static uint32_t pressAt = 0;
  static bool    longSent = false;

  int raw = digitalRead(PIN_BUTTON);
  if (raw != lastRaw) {
    lastRaw = raw;
    debounceAt = millis();
  }

  if ((int32_t)(millis() - debounceAt) >= (int32_t)BTN_DEBOUNCE_MS) {
    if (raw != stableRaw) {
      bool was = (stableRaw >= 0) ? sideIsPressed(stableRaw) : false;
      stableRaw = raw;
      bool now = sideIsPressed(stableRaw);
      s_sidePressed = now;

      if (now && !was) {
        pressAt = millis();
        longSent = false;
      } else if (!now && was) {
        if (!longSent) {
          uint32_t held = millis() - pressAt;
          if (held >= BTN_SHORT_MIN_MS)
            s_button = 1;
        }
      }
    } else {
      s_sidePressed = sideIsPressed(stableRaw);
    }
  }

  if (s_sidePressed && !longSent && (millis() - pressAt) >= BTN_LONG_MS) {
    s_button = 2;
    longSent = true;
  }
}

void poll() {
  s_button = 0;
  s_rotDir = 0;
  s_rotated = enc.encoderChanged();
  if (s_rotated) {
    int v = enc.readEncoder();
    if (v > s_lastEnc)       s_rotDir = 1;
    else if (v < s_lastEnc)  s_rotDir = -1;
    s_lastEnc = v;
    if (s_mode == INPUT_DURATION)
      s_minutes = v * DUR_STEP_MIN;
  }
  s_clicked = enc.isEncoderButtonClicked();
  pollSideButton();
}

bool rotated()     { return s_rotated; }
int  rotationDir() { return s_rotDir; }
int  minutes()     { return s_minutes; }
void setMinutes(int m) {
  if (m < DUR_MIN_MIN) m = DUR_MIN_MIN;
  if (m > DUR_MAX_MIN) m = DUR_MAX_MIN;
  s_minutes = m; enc.setEncoderValue(m / DUR_STEP_MIN);
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
