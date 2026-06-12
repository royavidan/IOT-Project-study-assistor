/*
  Side tactile button test (MindBox GPIO 4)
  ---------------------------------------
  Wire: one leg -> GPIO 4, other leg -> GND
  (internal pull-up — pressed = LOW)

  Serial Monitor: 115200 baud
*/

static constexpr int kBtnPin = 4;

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(kBtnPin, INPUT_PULLUP);
  Serial.println("\n=== Side button test (GPIO 4) ===");
  Serial.printf("Idle level: %d (expect 1 = released)\n", digitalRead(kBtnPin));
  Serial.println("Press the side button — tap vs hold 1s+");
}

void loop() {
  static int last = HIGH;
  static unsigned long downAt = 0;
  const int v = digitalRead(kBtnPin);

  if (v != last) {
    delay(30);
    const int stable = digitalRead(kBtnPin);
    if (stable != last) {
      last = stable;
      if (stable == LOW) {
        downAt = millis();
        Serial.println("[btn] down");
      } else {
        const unsigned long held = millis() - downAt;
        Serial.printf("[btn] up (held %lu ms)\n", held);
        if (held < 30) {
          Serial.println("  -> too quick to register in MindBox");
        } else if (held < 1000) {
          Serial.println("  -> SHORT press (start/pause in MindBox)");
        } else {
          Serial.println("  -> LONG press (reset in MindBox)");
        }
      }
    }
  }
  delay(5);
}
