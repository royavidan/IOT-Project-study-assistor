#include "Haptics.h"
#include "config.h"

static uint16_t s_steps[12];
static uint8_t  s_len = 0, s_idx = 0;
static uint32_t s_nextAt = 0;
static bool     s_on = false;
static bool     s_enabled = true;

namespace Haptics {

void init() { pinMode(PIN_HAPTIC, OUTPUT); digitalWrite(PIN_HAPTIC, LOW); }

void setEnabled(bool e) {
  s_enabled = e;
  if (!e) { digitalWrite(PIN_HAPTIC, LOW); s_on = false; s_len = s_idx = 0; }
}

static void applyStep() {
  digitalWrite(PIN_HAPTIC, (s_idx % 2 == 0) ? HIGH : LOW);  // even=on, odd=off
  s_nextAt = millis() + s_steps[s_idx];
}

void play(const uint16_t* steps, uint8_t len) {
  if (!s_enabled || len == 0) return;
  if (len > 12) len = 12;
  memcpy(s_steps, steps, len * sizeof(uint16_t));
  s_len = len; s_idx = 0; s_on = true; applyStep();
}

void tick() {
  if (!s_on) return;
  if ((int32_t)(millis() - s_nextAt) >= 0) {
    s_idx++;
    if (s_idx >= s_len) { digitalWrite(PIN_HAPTIC, LOW); s_on = false; return; }
    applyStep();
  }
}

void stopAll() { digitalWrite(PIN_HAPTIC, LOW); s_on = false; s_len = s_idx = 0; }

void tap()      { uint16_t p[] = {120};         play(p, 1); }
void click()    { uint16_t p[] = {60};          play(p, 1); }
void pause()    { uint16_t p[] = {80, 80, 80};  play(p, 3); }
void resume()   { uint16_t p[] = {300};         play(p, 1); }
void complete() { uint16_t p[] = {250,120,250}; play(p, 3); }
void reset()    { uint16_t p[] = {400};         play(p, 1); }

} // namespace Haptics
