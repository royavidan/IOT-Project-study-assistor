/*
  OLED I2C diagnostic (MindBox wiring)
  ------------------------------------
  Connect ONLY the display first (disconnect ToF / other I2C devices).

  OLED module  ->  ESP32 DevKit V1
  VCC          ->  3.3V
  GND          ->  GND
  SDA          ->  GPIO 21  (not "SOA" — common typo)
  SCL          ->  GPIO 22  (sometimes labeled SCK on modules)

  Serial Monitor: 115200 baud
*/

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <Adafruit_SSD1306.h>

static constexpr int kSda = 21;
static constexpr int kScl = 22;

Adafruit_SH1106G sh1106(128, 64, &Wire, -1);
Adafruit_SSD1306 ssd1306(128, 64, &Wire, -1);

bool probe(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

// When idle, both lines should read HIGH (1). LOW = stuck/shorted/loose wire.
void checkBusIdle() {
  pinMode(kSda, INPUT_PULLUP);
  pinMode(kScl, INPUT_PULLUP);
  delay(1);
  const int sda = digitalRead(kSda);
  const int scl = digitalRead(kScl);
  Serial.printf("[i2c] idle levels: SDA=%d SCL=%d (expect both 1)\n", sda, scl);
  if (sda == 0) {
    Serial.println("[i2c] SDA stuck LOW — loose GND/SDA, swapped wires, or device holding bus");
  }
  if (scl == 0) {
    Serial.println("[i2c] SCL stuck LOW — check SCL wire; ToF/OLED may be holding clock");
  }
  if (sda == 1 && scl == 1) {
    Serial.println("[i2c] lines look idle OK — if scan still NONE, VCC/GND or OLED module");
  }
}

// Release a slave that hung mid-transaction (common with shared I2C + breadboard).
void recoverBus() {
  Wire.end();
  pinMode(kSda, INPUT_PULLUP);
  pinMode(kScl, OUTPUT);
  for (int i = 0; i < 9; i++) {
    digitalWrite(kScl, LOW);
    delayMicroseconds(5);
    digitalWrite(kScl, HIGH);
    delayMicroseconds(5);
  }
  pinMode(kSda, INPUT_PULLUP);
  pinMode(kScl, INPUT_PULLUP);
  Wire.begin(kSda, kScl);
  Wire.setClock(100000);
  Wire.setTimeOut(25);
  delay(10);
}

void scanBus() {
  Serial.print("[i2c] scan:");
  int n = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    if (probe(addr)) {
      Serial.printf(" 0x%02X", addr);
      n++;
    }
  }
  if (n == 0) {
    Serial.println(" (NONE)");
    Serial.println();
    Serial.println("No I2C devices found. Check:");
    Serial.println("  - VCC -> 3.3V (not 5V unless module is 5V-safe)");
    Serial.println("  - GND -> GND");
    Serial.println("  - SDA -> GPIO 21");
    Serial.println("  - SCL -> GPIO 22");
    Serial.println("  - SDA/SCL not swapped");
    Serial.println("  - Firm breadboard contacts / try other wires");
    Serial.println("  - Disconnect VL53L1X ToF while testing OLED alone");
    Serial.println("  - Encoder SW must be GPIO 23 (NOT 21 — 21 is SDA)");
    Serial.println("  - Intermittent? Wiggle wires — bad breadboard rows are common");
  } else {
    Serial.println();
  }
}

bool tryDisplay() {
  static constexpr uint8_t kAddrs[] = {0x3C, 0x3D};

  for (uint8_t addr : kAddrs) {
    if (!probe(addr)) {
      continue;
    }
    Serial.printf("[oled] probing 0x%02X as SH1106...\n", addr);
    if (sh1106.begin(addr, true)) {
      Serial.printf("[oled] OK — SH1106 @ 0x%02X\n", addr);
      sh1106.clearDisplay();
      sh1106.setTextSize(1);
      sh1106.setTextColor(SH110X_WHITE);
      sh1106.setCursor(0, 0);
      sh1106.println("MindBox OLED OK");
      sh1106.printf("SH1106 @ 0x%02X", addr);
      sh1106.display();
      return true;
    }
    Serial.printf("[oled] probing 0x%02X as SSD1306...\n", addr);
    if (ssd1306.begin(SSD1306_SWITCHCAPVCC, addr, true)) {
      Serial.printf("[oled] OK — SSD1306 @ 0x%02X\n", addr);
      ssd1306.clearDisplay();
      ssd1306.setTextSize(1);
      ssd1306.setTextColor(SSD1306_WHITE);
      ssd1306.setCursor(0, 0);
      ssd1306.println("MindBox OLED OK");
      ssd1306.printf("SSD1306 @ 0x%02X", addr);
      ssd1306.display();
      return true;
    }
    Serial.printf("[oled] device at 0x%02X ACKs but driver init failed\n", addr);
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("=== MindBox OLED diagnostic ===");

  pinMode(kSda, INPUT_PULLUP);
  pinMode(kScl, INPUT_PULLUP);
  Wire.begin(kSda, kScl);
  Wire.setClock(100000);
  Wire.setTimeOut(25);
  delay(50);

  checkBusIdle();
  recoverBus();
  scanBus();

  if (!tryDisplay()) {
    Serial.println("[oled] FAILED — fix wiring, then press EN/RESET on ESP32");
  }
}

void loop() {
  delay(5000);
  Serial.println("[i2c] rescanning...");
  checkBusIdle();
  recoverBus();
  scanBus();
  tryDisplay();
}
