/*
  KY-040 Rotary Encoder Unit Test (ESP32)
  Verifies physical rotation steps, direction detection, and push-button functionality.
*/

/*
Connect GND to GND
Connect + (VCC) to 3.3V
Connect SW to D21
Connect DT to D19
Connect CLK to D18
*/

#include <AiEsp32RotaryEncoder.h>

#define ROTARY_ENCODER_A_PIN 18
#define ROTARY_ENCODER_B_PIN 19
#define ROTARY_ENCODER_BUTTON_PIN 21
#define ROTARY_ENCODER_VCC_PIN -1
#define ROTARY_ENCODER_STEPS 4

// Create the encoder object
AiEsp32RotaryEncoder rotaryEncoder = AiEsp32RotaryEncoder(
  ROTARY_ENCODER_A_PIN, 
  ROTARY_ENCODER_B_PIN, 
  ROTARY_ENCODER_BUTTON_PIN, 
  ROTARY_ENCODER_VCC_PIN, 
  ROTARY_ENCODER_STEPS
);

// Interrupt Service Routine (ISR) for reading hardware states
void IRAM_ATTR readEncoderISR() {
  rotaryEncoder.readEncoder_ISR();
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n--- KY-040 Rotary Encoder Unit Test ---");
  
  // Initialize and assign hardware interrupt
  rotaryEncoder.begin();
  rotaryEncoder.setup(readEncoderISR);

  // Set testing boundaries (0 to 100, no wrapping)
  rotaryEncoder.setBoundaries(0, 100, false); 
  rotaryEncoder.setAcceleration(250); 

  Serial.println("Encoder successfully initialized!");
  Serial.println("Rotate the encoder or press the shaft button to test.");
  Serial.println("-----------------------------------------------------");
}

void loop() {
  // Check for rotational change
  if (rotaryEncoder.encoderChanged()) {
    int16_t current_value = rotaryEncoder.readEncoder();
    Serial.print("Encoder Position: ");
    Serial.print(current_value);
    Serial.println();
  }

  // Check for button press activity
  if (rotaryEncoder.isEncoderButtonClicked()) {
    Serial.println("Button Event: Click Detected! (Resetting position to 0)");
    rotaryEncoder.setEncoderValue(0);
  }
  
  // Minor delay to yield execution to the ESP32 background tasks
  delay(10);
}