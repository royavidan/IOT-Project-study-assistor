#include "Haptics.h"
#include "config.h"
#if defined(ESP32)
#include <driver/gpio.h>
#endif

static uint16_t s_steps[12];
static uint8_t  s_len = 0, s_idx = 0;
static uint32_t s_nextAt = 0;
static bool     s_on = false;
static bool     s_enabled = true;
static bool     s_motorOn = false;   // live pin state, for isHolding()
#if HAPTIC_USE_PWM
static bool     s_pwm = false;
static int      s_ledcCh = 0;
static uint8_t  s_duty = HAPTIC_DUTY;   // current on-duty, scaled by setLevel()
#endif

namespace Haptics {

static void motorWrite(bool on) {
  s_motorOn = on;
#if HAPTIC_USE_PWM
  uint32_t duty = on ? (uint32_t)s_duty : 0;
  if (s_pwm) {
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    ledcWrite(PIN_HAPTIC, duty);
#else
    ledcWrite(s_ledcCh, duty);
#endif
    return;
  }
#endif
  digitalWrite(PIN_HAPTIC, on ? HIGH : LOW);
}

static void applyStep() {
  motorWrite(s_idx % 2 == 0);
  s_nextAt = millis() + s_steps[s_idx];
}

static void startPattern(const uint16_t* steps, uint8_t len) {
  if (len == 0) return;
  if (len > 12) len = 12;
  memcpy(s_steps, steps, len * sizeof(uint16_t));
  s_len = len; s_idx = 0; s_on = true; applyStep();
}

static void startBurst(uint16_t onMs, uint16_t gapMs, uint8_t count) {
  if (count == 0 || count > 6) return;
  uint16_t p[12];
  uint8_t n = 0;
  for (uint8_t i = 0; i < count && n + 1 <= 12; i++) {
    p[n++] = onMs;
    if (i + 1 < count && n < 12) p[n++] = gapMs;
  }
  startPattern(p, n);
}

// Steady full ON — used for Test motor / enable confirm (max firmware power).
static void holdPower(uint32_t ms) {
  stopAll();
  motorWrite(true);
  uint32_t end = millis() + ms;
  while ((int32_t)(millis() - end) < 0) delay(1);
  motorWrite(false);
}

void init() {
  pinMode(PIN_HAPTIC, OUTPUT);
  digitalWrite(PIN_HAPTIC, LOW);
#if defined(ESP32)
  gpio_set_drive_capability((gpio_num_t)PIN_HAPTIC, GPIO_DRIVE_CAP_3);
#endif
#if PIN_HAPTIC == 2
  Serial.println("[haptic] WARN: GPIO2 shares onboard LED — use GPIO25 for full drive.");
#endif
#if HAPTIC_USE_PWM
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  (void)ledcAttach(PIN_HAPTIC, HAPTIC_FREQ_HZ, 8);
  s_pwm = true;
  ledcWrite(PIN_HAPTIC, 0);
#else
  ledcSetup(s_ledcCh, HAPTIC_FREQ_HZ, 8);
  ledcAttachPin(PIN_HAPTIC, s_ledcCh);
  s_pwm = true;
  ledcWrite(s_ledcCh, 0);
#endif
#endif
}

void setEnabled(bool e) {
  s_enabled = e;
  if (!e) { motorWrite(false); s_on = false; s_len = s_idx = 0; }
}

void setLevel(uint8_t level) {
#if HAPTIC_USE_PWM
  static const uint8_t duties[3] = { 90, 170, 255 };   // low / med / high
  s_duty = duties[level > 2 ? 2 : level];
#else
  (void)level;   // digital drive: strength not adjustable
#endif
}

void play(const uint16_t* steps, uint8_t len) {
  if (!s_enabled || len == 0) return;
  startPattern(steps, len);
}

void tick() {
  if (!s_on) return;
  if ((int32_t)(millis() - s_nextAt) >= 0) {
    s_idx++;
    if (s_idx >= s_len) { motorWrite(false); s_on = false; return; }
    applyStep();
  }
}

void stopAll() { motorWrite(false); s_on = false; s_len = s_idx = 0; }

bool isHolding() { return s_motorOn; }

void tap() {
  uint16_t p[] = { HAPTIC_MS_TAP, 120, HAPTIC_MS_TAP };
  play(p, 3);
}

void click() {
  uint16_t p[] = { HAPTIC_MS_CLICK };
  play(p, 1);
}

void enableTest() {
  if (!s_enabled) return;
  holdPower(HAPTIC_TEST_HOLD_MS);
}

void testPulse() {
  holdPower(HAPTIC_TEST_HOLD_MS);
}

void pause() {
  uint16_t p[] = { HAPTIC_MS_PAUSE, HAPTIC_MS_PAUSE_GAP,
                   HAPTIC_MS_PAUSE, HAPTIC_MS_PAUSE_GAP,
                   HAPTIC_MS_PAUSE };
  play(p, 5);
}

void resume() {
  uint16_t p[] = { HAPTIC_MS_RESUME, 150, HAPTIC_MS_RESUME };
  play(p, 3);
}

void complete() {
  uint16_t p[] = { HAPTIC_MS_COMPLETE, HAPTIC_MS_COMPLETE_GAP,
                   HAPTIC_MS_COMPLETE, HAPTIC_MS_COMPLETE_GAP,
                   HAPTIC_MS_COMPLETE, HAPTIC_MS_COMPLETE_GAP,
                   HAPTIC_MS_COMPLETE };
  play(p, 7);
}

void reset() {
  uint16_t p[] = { HAPTIC_MS_RESET, 180, HAPTIC_MS_RESET };
  play(p, 3);
}

} // namespace Haptics
