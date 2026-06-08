/*
  SH1106 OLED Screen Unit Test (1.3 inch)
  Verifies I2C communication and pixel mapping for the SH1106 controller.
*/

/*
Connect VCC to 3.3V
Connect GND to GND
Connect SCK to D22
Connect SOA to D21
*/

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>

#define SCREEN_WIDTH 128 
#define SCREEN_HEIGHT 64 

#define i2c_Address 0x3c 

#define OLED_RESET -1 

Adafruit_SH1106G display = Adafruit_SH1106G(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

void setup() {
  Serial.println("Started setup");
  Serial.begin(9600);
  Serial.println("--- SH1106 OLED Unit Test Initialized ---");

  delay(250); 

  if(!display.begin(i2c_Address, true)) {
    Serial.println("Error: SH1106 allocation failed. Check wiring and address.");
    for(;;); // Freeze if screen is not found
  }

  Serial.println("SH1106 Screen found! Drawing test sequence...");

  display.clearDisplay();
  display.setTextSize(1);             
  display.setTextColor(SH110X_WHITE); // Note: SH110X_WHITE instead of SSD1306_WHITE
  display.setCursor(0, 10);           

  display.println("MindBox UI Test");
  display.println("---------------");
  display.println("Controller: SH1106");
  display.println("I2C Comms: OK");
  display.println("Pixels: OK");

  display.display(); 
}

void loop() {

}