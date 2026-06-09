/*
  TOF400C (VL53L1X) Unit Test - ADAFRUIT LIBRARY VERSION
  Verifies I2C communication and measures long-range distance in mm/cm.
*/

#include <Wire.h>
#include "Adafruit_VL53L1X.h"

// Define the optional XSHUT and Interrupt pins
// We set them to -1 because we are managing XSHUT via hardwiring to 3V3
#define IRQ_PIN -1
#define XSHUT_PIN -1

// Create the sensor object
Adafruit_VL53L1X vl53 = Adafruit_VL53L1X(XSHUT_PIN, IRQ_PIN);

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  Serial.println("\n--- Adafruit VL53L1X Sensor Test ---");
  Wire.begin();
  if (!vl53.begin(0x29, &Wire)) {
    Serial.print("Error: Failed to find sensor. Check wiring!");
    while (1) delay(10);
  }
  Serial.println("Sensor found!");

  vl53.VL53L1X_SetDistanceMode(2); //1: short, 2: long, 3: medium
  vl53.setTimingBudget(50); 

  vl53.startRanging();
  Serial.println("Starting long-range measurements...");
  Serial.println("-----------------------------------");
}

void loop() {
  if (vl53.dataReady()) {
    int16_t distance_mm = vl53.distance();
    if (distance_mm != -1) {
      Serial.print("Distance: ");
      Serial.print(distance_mm);
      Serial.print(" mm \t(");
      Serial.print(distance_mm / 10.0);
      Serial.println(" cm)");
    }
    vl53.clearInterrupt();
  }
}