/*
  GY-MAX9814 Microphone Unit Test (ESP32)
  Calculates the peak-to-peak volume amplitude over 50ms windows.
*/

/*
Connect VIN to 3.3V
Connect GND to GND
Connect OUT to D34
*/

const int sampleWindow = 50;
const int micPin = 34;

unsigned int sample;

void setup() {
  // Set to 115200 to avoid boot gibberish!
  Serial.begin(115200); 
}

void loop() {
  unsigned long startMillis = millis();
  unsigned int signalMax = 0;
  unsigned int signalMin = 4095;
  while (millis() - startMillis < sampleWindow) {
    sample = analogRead(micPin);
    if (sample < 4095) {
      if (sample > signalMax) {
        signalMax = sample;
      }
      else if (sample < signalMin) {
        signalMin = sample;
      }
    }
  }
  unsigned int peakToPeak = signalMax - signalMin;
  Serial.println(peakToPeak);
}