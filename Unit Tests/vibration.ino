/*
  Vibration Motor Unit Test
  Tests both basic ON/OFF functionality and variable intensity using PWM.
*/

/*
Connect VCC to 3.3V
Connect GND to GND
Connect IN to GPIO2
*/

const int motorPin = LED_BUILTIN; 

void setup() {
  pinMode(motorPin, OUTPUT);
  Serial.begin(9600);
  Serial.println("--- Vibration Motor Test Initialized ---");
}

void loop() {
  // --------------------------------------------------
  // TEST 1: Basic Digital ON/OFF
  // --------------------------------------------------
  Serial.println("Test 1: Full Power (HIGH)");
  digitalWrite(motorPin, HIGH);
  delay(1000);

  Serial.println("Test 1: Power OFF (LOW)");
  digitalWrite(motorPin, LOW);
  delay(1000);

  // --------------------------------------------------
  // TEST 2: Variable Intensity
  // --------------------------------------------------
  Serial.println("Test 2: Ramping up intensity...");
  for (int intensity = 0; intensity <= 255; intensity += 25) {
    Serial.print("Current Intensity Level: ");
    Serial.println(intensity);
    analogWrite(motorPin, intensity);
    delay(750);
  }
  Serial.println("Test 2: Power OFF (LOW)");
  analogWrite(motorPin, 0);
  Serial.println("--- Loop complete. Restarting in 3 seconds. ---");
  Serial.println("");
  delay(3000);
}