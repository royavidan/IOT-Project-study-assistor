#include "Haptics.h"
#include "config.h"
#if defined(ESP32)
#include <driver/gpio.h>
#endif

static uint16_t s_steps[16];
static uint8_t  s_len = 0, s_idx = 0;
static uint32_t s_nextAt = 0;
static uint32_t s_holdUntil = 0;
static bool     s_on = false;
static bool     s_enabled = true;
static bool     s_forceHold = false;
#if HAPTIC_USE_PWM
static bool     s_pwm = false;
static int      s_ledcCh = 0;
#endif

namespace Haptics {

static uint16_t scaleOn(uint16_t ms) {
#if HAPTIC_STRENGTH <= 0
  return (uint16_t)((uint32_t)ms * 80UL / 100UL);
#elif HAPTIC_STRENGTH == 1
  return ms;
#else
  return (uint16_t)((uint32_t)ms * 145UL / 100UL);
#endif
}

static uint16_t scaleGap(uint16_t ms) {
#if HAPTIC_STRENGTH <= 0
  return (uint16_t)((uint32_t)ms * 150UL / 100UL);
#elif HAPTIC_STRENGTH == 1
  return ms;
#else
  return (uint16_t)((uint32_t)ms * 50UL / 100UL);
#endif
}

static int motorPinLevel(bool on) {
#if HAPTIC_ACTIVE_LOW
  return on ? 0 : 1;
#else
  return on ? 1 : 0;
#endif
}

static void motorWrite(bool on) {
  const int level = motorPinLevel(on);
#if HAPTIC_USE_PWM
  if (s_pwm) {
    const uint32_t duty = on ? (uint32_t)HAPTIC_DUTY : 0;
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    ledcWrite(PIN_HAPTIC, duty);
#else
    ledcWrite(s_ledcCh, duty);
#endif
    return;
  }
#endif
#if defined(ESP32)
  gpio_set_level((gpio_num_t)PIN_HAPTIC, level);
#else
  digitalWrite(PIN_HAPTIC, level ? HIGH : LOW);
#endif
}

static int motorPinReadback() {
#if defined(ESP32)
  return gpio_get_level((gpio_num_t)PIN_HAPTIC);
#else
  return digitalRead(PIN_HAPTIC) == HIGH ? 1 : 0;
#endif
}

static void endOutput() {
  motorWrite(false);
  s_on = false;
  s_len = s_idx = 0;
  s_holdUntil = 0;
  if (s_forceHold) {
    s_forceHold = false;
    Serial.printf("[haptic] OFF GPIO%d level=%d\n", PIN_HAPTIC, motorPinReadback());
  }
}

static void applyStep() {
  motorWrite(s_idx % 2 == 0);
  s_nextAt = millis() + s_steps[s_idx];
}

static void startPattern(const uint16_t* steps, uint8_t len, bool force) {
  if (len == 0) return;
  if (len > sizeof(s_steps) / sizeof(s_steps[0])) len = sizeof(s_steps) / sizeof(s_steps[0]);
  s_holdUntil = 0;
  s_forceHold = force;
  memcpy(s_steps, steps, len * sizeof(uint16_t));
  s_len = len; s_idx = 0; s_on = true;
  applyStep();
  if (force) {
    Serial.printf("[haptic] burst start GPIO%d (%u steps)\n", PIN_HAPTIC, (unsigned)len);
  }
}

static void startTestBurst() {
  const uint16_t on = scaleOn(HAPTIC_BURST_ON_MS);
  const uint16_t gap = scaleGap(HAPTIC_BURST_GAP_MS);
  uint16_t p[16];
  uint8_t n = 0;
  for (uint8_t i = 0; i < HAPTIC_BURST_N && n < sizeof(p) / sizeof(p[0]); i++) {
    p[n++] = on;
    if (i + 1 < HAPTIC_BURST_N && n < sizeof(p) / sizeof(p[0]))
      p[n++] = gap;
  }
  if (n == 0) return;
  Serial.printf("[haptic] burst %u x %u ms ON / %u ms gap\n",
                (unsigned)HAPTIC_BURST_N, (unsigned)on, (unsigned)gap);
  startPattern(p, n, true);
}

static void startHold(uint32_t ms, bool force) {
  s_len = s_idx = 0;
  s_on = false;
  s_forceHold = force;
  motorWrite(true);
  s_holdUntil = millis() + ms;
  Serial.printf("[haptic] ON  GPIO%d level=%d for %u ms%s\n",
                PIN_HAPTIC, motorPinReadback(), (unsigned)ms,
                force ? " (test)" : "");
}

void init() {
#if defined(ESP32)
  gpio_reset_pin((gpio_num_t)PIN_HAPTIC);
  gpio_set_direction((gpio_num_t)PIN_HAPTIC, GPIO_MODE_OUTPUT);
  gpio_set_drive_capability((gpio_num_t)PIN_HAPTIC, GPIO_DRIVE_CAP_3);
#else
  pinMode(PIN_HAPTIC, OUTPUT);
#endif
  motorWrite(false);
#if HAPTIC_USE_PWM
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  if (ledcAttach(PIN_HAPTIC, HAPTIC_FREQ_HZ, 8)) {
    s_pwm = true;
    ledcWrite(PIN_HAPTIC, 0);
  }
#else
  ledcSetup(s_ledcCh, HAPTIC_FREQ_HZ, 8);
  ledcAttachPin(PIN_HAPTIC, s_ledcCh);
  s_pwm = true;
  ledcWrite(s_ledcCh, 0);
#endif
#endif
#if PIN_HAPTIC == 2
  Serial.println("[haptic] WARN: GPIO2 shares onboard LED — rewire motor driver to GPIO25.");
#endif
  Serial.printf("[haptic] motor GPIO%d strength=%d pwm=%d (serial 'v' = wiring test)\n",
                PIN_HAPTIC, HAPTIC_STRENGTH,
#if HAPTIC_USE_PWM
                s_pwm ? 1 : 0
#else
                0
#endif
  );
}

void setEnabled(bool e) {
  s_enabled = e;
  if (!e && !s_forceHold) stopAll();
}

void play(const uint16_t* steps, uint8_t len) {
  if (!s_enabled || len == 0) return;
  startPattern(steps, len, false);
}

void tick() {
  if (s_holdUntil) {
    if ((int32_t)(millis() - s_holdUntil) >= 0) endOutput();
    return;
  }
  if (!s_on) return;
  if ((int32_t)(millis() - s_nextAt) >= 0) {
    s_idx++;
    if (s_idx >= s_len) { endOutput(); return; }
    applyStep();
  }
}

void stopAll() {
  if (s_forceHold) return;
  endOutput();
}

bool isHolding() { return s_holdUntil != 0 || s_on; }

void tap() {
  const uint16_t on = scaleOn(HAPTIC_MS_TAP);
  const uint16_t gap = scaleGap(120);
  uint16_t p[] = { on, gap, on };
  play(p, 3);
}

void click() {
  uint16_t p[] = { scaleOn(HAPTIC_MS_CLICK) };
  play(p, 1);
}

void enableTest() {
  if (!s_enabled) return;
  startTestBurst();
}

void testPulse() {
  // Continuous full power — strongest feel (ERM at max RPM).
  startHold(scaleOn(HAPTIC_TEST_HOLD_MS), true);
}

void wiringTest() {
  s_forceHold = false;
  stopAll();
  Serial.println("[haptic] === wiring test ===");
  Serial.println("[haptic] Motor must go through NPN/MOSFET driver (NOT direct to GPIO).");
  Serial.println("[haptic] Driver IN should be on GPIO25. Motor power = 5V.");

  Serial.println("[haptic] Phase A: configured polarity ON (3s)");
  motorWrite(true);
  Serial.printf("[haptic]   GPIO%d readback=%d\n", PIN_HAPTIC, motorPinReadback());
  for (int i = 0; i < 30; i++) { yield(); delay(100); }
  motorWrite(false);
  delay(500);

  Serial.println("[haptic] Phase B: opposite polarity ON (3s)");
#if defined(ESP32)
  gpio_set_level((gpio_num_t)PIN_HAPTIC, motorPinLevel(true) ? 0 : 1);
#else
  digitalWrite(PIN_HAPTIC, motorPinLevel(true) ? LOW : HIGH);
#endif
  Serial.printf("[haptic]   GPIO%d readback=%d\n", PIN_HAPTIC, motorPinReadback());
  for (int i = 0; i < 30; i++) { yield(); delay(100); }
  motorWrite(false);

  Serial.println("[haptic] Phase C: burst pattern (like Test motor menu)");
  startTestBurst();
  while (isHolding()) { yield(); delay(50); }

  Serial.println("[haptic] If only Phase B vibrated, set HAPTIC_ACTIVE_LOW 1 in config.h");
  Serial.println("[haptic] If none vibrated: check transistor, 5V, and GPIO25 wiring.");
  Serial.println("[haptic] === done ===");
}

void pause() {
  const uint16_t on = scaleOn(HAPTIC_MS_PAUSE);
  const uint16_t gap = scaleGap(HAPTIC_MS_PAUSE_GAP);
  uint16_t p[] = { on, gap, on, gap, on };
  play(p, 5);
}

void resume() {
  const uint16_t on = scaleOn(HAPTIC_MS_RESUME);
  const uint16_t gap = scaleGap(160);
  uint16_t p[] = { on, gap, on };
  play(p, 3);
}

void complete() {
  const uint16_t on = scaleOn(HAPTIC_MS_COMPLETE);
  const uint16_t gap = scaleGap(HAPTIC_MS_COMPLETE_GAP);
  uint16_t p[] = { on, gap, on, gap, on, gap, on };
  play(p, 7);
}

void reset() {
  const uint16_t on = scaleOn(HAPTIC_MS_RESET);
  const uint16_t gap = scaleGap(180);
  uint16_t p[] = { on, gap, on };
  play(p, 3);
}

} // namespace Haptics
