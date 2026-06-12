/*
  HC-SR04 Ultrasonic Sensor Unit Test (ESP32)
  Verifies the trigger pulse and measures distance in cm.
*/

/*
Connect VCC to 5V
Connect Trig to D5
Connect GND to GND
Connect Echo to D18 with 1 resistor
Connect D18 to GND with 2 resistors
*/

const int trigPin = 5;
const int echoPin = 18;

long duration;
float distanceCm;

void setup() {
  Serial.begin(9600);
  Serial.println("--- HC-SR04 Unit Test Initialized ---");
  pinMode(trigPin, OUTPUT); // Trig sends the sound wave
  pinMode(echoPin, INPUT);  // Echo receives the bounce back
}

void loop() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  
  duration = pulseIn(echoPin, HIGH);
  distanceCm = duration * 0.034 / 2;
  Serial.print("Distance: ");
  Serial.print(distanceCm);
  Serial.println(" cm");
  delay(100); 
}