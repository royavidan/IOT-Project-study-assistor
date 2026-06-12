/*
  Vibration Motor Unit Test (ESP32 DOIT DevKit V1)
  Matches MindBox firmware: PIN_HAPTIC = GPIO 25 (NOT GPIO 2).

  Wiring (NPN transistor driver — required):
    ESP32 GPIO 25 --[1k resistor]--> NPN base (e.g. 2N2222 / S8050)
    NPN emitter  --> GND
    Motor (+)    --> 5V (USB 5V pin on DevKit)
    Motor (-)    --> NPN collector
    Flyback diode across motor (cathode to +, anode to -)

  OR a 3-pin "vibration module" (VCC, GND, IN):
    VCC -> 5V, GND -> GND, IN -> GPIO 25

  Do NOT connect the motor directly to a GPIO pin.
*/

#if defined(ESP32)
#include <driver/gpio.h>
#endif

#define PIN_HAPTIC        25
#define HAPTIC_ACTIVE_LOW 0

static void motorLevel(bool on) {
  int level;
#if HAPTIC_ACTIVE_LOW
  level = on ? 0 : 1;
#else
  level = on ? 1 : 0;
#endif
#if defined(ESP32)
  gpio_set_level((gpio_num_t)PIN_HAPTIC, level);
#else
  digitalWrite(PIN_HAPTIC, level ? HIGH : LOW);
#endif
}

void setup() {
  Serial.begin(115200);
  delay(500);

#if defined(ESP32)
  gpio_reset_pin((gpio_num_t)PIN_HAPTIC);
  gpio_set_direction((gpio_num_t)PIN_HAPTIC, GPIO_MODE_OUTPUT);
  gpio_set_drive_capability((gpio_num_t)PIN_HAPTIC, GPIO_DRIVE_CAP_3);
#else
  pinMode(PIN_HAPTIC, OUTPUT);
#endif
  motorLevel(false);

  Serial.println("\n--- Vibration Motor Unit Test ---");
  Serial.printf("Control pin: GPIO%d\n", PIN_HAPTIC);
  Serial.println("Phase A: configured polarity, 3s ON");
  Serial.println("Phase B: opposite polarity, 3s ON");
  Serial.println("If only Phase B works, set HAPTIC_ACTIVE_LOW 1 in config.h");
}

void loop() {
  Serial.println("\nPhase A: ON");
  motorLevel(true);
#if defined(ESP32)
  Serial.printf("GPIO readback=%d\n", gpio_get_level((gpio_num_t)PIN_HAPTIC));
#endif
  delay(3000);
  motorLevel(false);
  delay(500);

  Serial.println("Phase B: opposite polarity ON");
#if defined(ESP32)
  gpio_set_level((gpio_num_t)PIN_HAPTIC, HAPTIC_ACTIVE_LOW ? 1 : 0);
  Serial.printf("GPIO readback=%d\n", gpio_get_level((gpio_num_t)PIN_HAPTIC));
#else
  digitalWrite(PIN_HAPTIC, HAPTIC_ACTIVE_LOW ? HIGH : LOW);
#endif
  delay(3000);
  motorLevel(false);
  delay(2000);
}
