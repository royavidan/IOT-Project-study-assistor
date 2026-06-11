#include "Inputs.h"
#include "config.h"
#include <AiEsp32RotaryEncoder.h>

static AiEsp32RotaryEncoder enc(PIN_ENC_CLK, PIN_ENC_DT, PIN_ENC_SW, -1, 4);
static bool s_rotated = false, s_clicked = false;
static int  s_button = 0;
static int  s_minutes = DUR_DEFAULT_MIN;

static void IRAM_ATTR isr() { enc.readEncoder_ISR(); }

namespace Inputs {

void init() {
  pinMode(PIN_BUTTON, INPUT_PULLUP);
#if USE_SPDT_TOGGLE
  pinMode(PIN_SPDT, INPUT_PULLUP);
#endif
  enc.begin();
  enc.setup(isr);
  // express duration in 5-minute steps: encoderValue * 5 == minutes
  enc.setBoundaries(DUR_MIN_MIN / DUR_STEP_MIN, DUR_MAX_MIN / DUR_STEP_MIN, false);
  enc.setAcceleration(0);   // precise one-detent-per-click
  enc.setEncoderValue(DUR_DEFAULT_MIN / DUR_STEP_MIN);
}

// non-blocking debounced side button -> 0 none / 1 short / 2 long (on release)
static int buttonEvent() {
  static int last = HIGH, stable = HIGH;
  static uint32_t changeAt = 0, downAt = 0;
  int raw = digitalRead(PIN_BUTTON), ev = 0;
  if (raw != last) { last = raw; changeAt = millis(); }
  if (millis() - changeAt > 25 && raw != stable) {
    stable = raw;
    if (stable == LOW) downAt = millis();
    else {
      uint32_t held = millis() - downAt;
      if (held >= 1000)    ev = 2;
      else if (held >= 30) ev = 1;
    }
  }
  return ev;
}

void poll() {
  s_rotated = enc.encoderChanged();
  if (s_rotated) s_minutes = enc.readEncoder() * DUR_STEP_MIN;
  s_clicked = enc.isEncoderButtonClicked();
  s_button  = buttonEvent();
}

bool rotated()     { return s_rotated; }
int  minutes()     { return s_minutes; }
void setMinutes(int m) {
  if (m < DUR_MIN_MIN) m = DUR_MIN_MIN;
  if (m > DUR_MAX_MIN) m = DUR_MAX_MIN;
  s_minutes = m; enc.setEncoderValue(m / DUR_STEP_MIN);
}
bool knobClicked() { return s_clicked; }
int  button()      { return s_button; }

bool spdtPresentWork() {
#if USE_SPDT_TOGGLE
  return digitalRead(PIN_SPDT) == LOW;
#else
  return true;
#endif
}

} // namespace Inputs
