/**
 * NEX-ROVER: Arduino UNO R3 Main Controller & Motor Driver
 *
 * Responsibilities:
 * 1. Interfaces with HW-130 / L293D Motor Shield V1 (4 DC Motors).
 * 2. Receives Serial commands from ESP32-CAM at 115200 baud.
 * 3. Commands:
 *    - 'F'      -> Forward
 *    - 'B'      -> Backward
 *    - 'L'      -> Turn Left
 *    - 'R'      -> Turn Right
 *    - 'S'      -> Stop all motors
 *    - 'V:150'  -> Set speed from 0 to 255
 *    - 'ARM:*'  -> Forwards directly to Arduino Nano via SoftwareSerial (Pins 8, 9)
 *    - 'PING'   -> Health check response
 * 4. HC-SR04 Ultrasonic Sonar (Trig Pin 12, Echo Pin 13):
 *    - Automatically sends "DIST:<cm>" to ESP32-CAM every 250ms.
 */

#include <SoftwareSerial.h>

// L293D Motor Shield V1 Direct Pin Definitions (HW-130 compatible)
// Motors M1, M2, M3, M4 are controlled via 74HC595 shift register & PWM pins
#define MOTORLATCH 12
#define MOTORCLK   4
#define MOTORENABLE 7
#define MOTORDATA  8

#define MOTOR1_PWM 11
#define MOTOR2_PWM 3
#define MOTOR3_PWM 6
#define MOTOR4_PWM 5

// Direction bits in 74HC595 register
#define MOTOR1_A 2
#define MOTOR1_B 3
#define MOTOR2_A 1
#define MOTOR2_B 4
#define MOTOR3_A 5
#define MOTOR3_B 7
#define MOTOR4_A 0
#define MOTOR4_B 6

// Ultrasonic Sensor HC-SR04
#define TRIG_PIN A1
#define ECHO_PIN A2

// SoftwareSerial connection to Arduino Nano (Servos)
// Uno Pin 9 (RX) <- Nano TX, Uno Pin 10 (TX) -> Nano RX
SoftwareSerial nanoSerial(9, 10);

int motorSpeed = 160; // Default speed 0-255
unsigned long lastSonarTime = 0;

void latch_tx(uint8_t data) {
  digitalWrite(MOTORLATCH, LOW);
  shiftOut(MOTORDATA, MOTORCLK, MSBFIRST, data);
  digitalWrite(MOTORLATCH, HIGH);
}

void setMotorPins(uint8_t m1_a, uint8_t m1_b, uint8_t m2_a, uint8_t m2_b,
                  uint8_t m3_a, uint8_t m3_b, uint8_t m4_a, uint8_t m4_b) {
  uint8_t reg = 0;
  if (m1_a) reg |= (1 << MOTOR1_A);
  if (m1_b) reg |= (1 << MOTOR1_B);
  if (m2_a) reg |= (1 << MOTOR2_A);
  if (m2_b) reg |= (1 << MOTOR2_B);
  if (m3_a) reg |= (1 << MOTOR3_A);
  if (m3_b) reg |= (1 << MOTOR3_B);
  if (m4_a) reg |= (1 << MOTOR4_A);
  if (m4_b) reg |= (1 << MOTOR4_B);
  latch_tx(reg);
}

void setSpeeds(int spd) {
  analogWrite(MOTOR1_PWM, spd);
  analogWrite(MOTOR2_PWM, spd);
  analogWrite(MOTOR3_PWM, spd);
  analogWrite(MOTOR4_PWM, spd);
}

void roverForward() {
  setSpeeds(motorSpeed);
  setMotorPins(1, 0, 1, 0, 1, 0, 1, 0);
}

void roverBackward() {
  setSpeeds(motorSpeed);
  setMotorPins(0, 1, 0, 1, 0, 1, 0, 1);
}

void roverLeft() {
  setSpeeds(motorSpeed);
  // Skid steer left: left wheels reverse, right wheels forward
  setMotorPins(0, 1, 0, 1, 1, 0, 1, 0);
}

void roverRight() {
  setSpeeds(motorSpeed);
  // Skid steer right: left wheels forward, right wheels reverse
  setMotorPins(1, 0, 1, 0, 0, 1, 0, 1);
}

void roverStop() {
  setSpeeds(0);
  setMotorPins(0, 0, 0, 0, 0, 0, 0, 0);
}

long measureDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 25000); // 25ms timeout (~4m)
  if (duration == 0) return -1;
  return duration * 0.034 / 2;
}

void setup() {
  // Serial to ESP32-CAM
  Serial.begin(115200);

  // Serial to Arduino Nano (Robotic Arm)
  nanoSerial.begin(9600);

  // Motor shield pins
  pinMode(MOTORLATCH, OUTPUT);
  pinMode(MOTORCLK, OUTPUT);
  pinMode(MOTORENABLE, OUTPUT);
  pinMode(MOTORDATA, OUTPUT);
  digitalWrite(MOTORENABLE, LOW);

  pinMode(MOTOR1_PWM, OUTPUT);
  pinMode(MOTOR2_PWM, OUTPUT);
  pinMode(MOTOR3_PWM, OUTPUT);
  pinMode(MOTOR4_PWM, OUTPUT);

  // Sonar pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  roverStop();
}

void loop() {
  // 1. Process commands from ESP32-CAM
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "F") {
      roverForward();
    } else if (cmd == "B") {
      roverBackward();
    } else if (cmd == "L") {
      roverLeft();
    } else if (cmd == "R") {
      roverRight();
    } else if (cmd == "S") {
      roverStop();
    } else if (cmd.startsWith("V:")) {
      motorSpeed = constrain(cmd.substring(2).toInt(), 0, 255);
      setSpeeds(motorSpeed);
    } else if (cmd.startsWith("ARM:")) {
      // Forward command to Arduino Nano for SG90 arm servos
      nanoSerial.println(cmd);
    } else if (cmd == "PING") {
      Serial.println("PONG");
    }
  }

  // 2. Measure Sonar Distance periodically and send to ESP32
  if (millis() - lastSonarTime >= 250) {
    lastSonarTime = millis();
    long dist = measureDistanceCm();
    if (dist >= 0 && dist < 400) {
      Serial.print("DIST:");
      Serial.println(dist);

      // Auto-stop safety if obstacle is dangerously close (< 10cm) during forward motion
      if (dist < 10) {
        roverStop();
      }
    }
  }
}
