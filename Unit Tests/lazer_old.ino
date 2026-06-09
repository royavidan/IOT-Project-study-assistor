/*
  VL6180X Time-of-Flight Sensor Unit Test (ESP32)
  Verifies I2C communication and measures precise distance in mm.
*/

#include <Wire.h>
#include "Adafruit_VL6180X.h"

Adafruit_VL6180X vl = Adafruit_VL6180X();

void setup() {
  Serial.begin(9600);
  Serial.println("--- VL6180X ToF Sensor Test ---");
  while (!Serial) {
    delay(1);
  }

  if (!vl.begin()) {
    Serial.println("Error: Failed to find sensor. Check wiring and pins!");
    while (1); // Freeze execution if sensor is not detected
  }
  
  Serial.println("Sensor successfully initialized!");
}

void loop() {
  uint8_t range = vl.readRange();
  uint8_t status = vl.readRangeStatus();

  if (status == VL6180X_ERROR_NONE) {
    Serial.print("Distance: ");
    Serial.print(range);
    Serial.println(" mm");
  } else {
    Serial.print("Measurement Error. Code: ");
    Serial.println(status);
  }

  delay(500);
}