/**
 * NEX-ROVER: Arduino UNO R3 Main Controller & Motor Driver (Version 2.0)
 *
 * Hardware Interface:
 * 1. HW-130 / L293D Motor Shield V1 (4 DC Motors driven via 74HC595 shift register).
 * 2. HC-SR04 Ultrasonic Sonar (Trig A1, Echo A2) for real-time obstacle detection.
 * 3. SoftwareSerial (Pins 9 RX, 10 TX) to Arduino Nano for 4-DOF Robotic Arm.
 * 4. Hardware Serial (Pins 0 RX, 1 TX / USB) to Laptop PC or ESP32-CAM at 115200 baud.
 *
 * Protocol & Safety Features:
 * - Default stopped at boot.
 * - Hardware command watchdog: auto-stops motors if communication lapses > 1500ms during motion.
 * - Bounded duration per movement: movements auto-stop after <= 1000ms.
 * - Local obstacle safety: auto-stops forward drive if distance < 15cm.
 * - Explicit acknowledgements: "OK:<cmd>", "PONG:NEXROVER_UNO_V2", "ERR:<reason>".
 */

#include <SoftwareSerial.h>

// L293D Motor Shield V1 (HW-130 compatible) Pin Definitions
#define MOTORLATCH  12
#define MOTORCLK    4
#define MOTORENABLE 7
#define MOTORDATA   8

#define MOTOR1_PWM  11
#define MOTOR2_PWM  3
#define MOTOR3_PWM  6
#define MOTOR4_PWM  5

// Direction bits in 74HC595 shift register
#define MOTOR1_A 2
#define MOTOR1_B 3
#define MOTOR2_A 1
#define MOTOR2_B 4
#define MOTOR3_A 5
#define MOTOR3_B 7
#define MOTOR4_A 0
#define MOTOR4_B 6

// Ultrasonic Sensor HC-SR04 Pins
#define TRIG_PIN A1
#define ECHO_PIN A2

// SoftwareSerial to Arduino Nano (Servos)
SoftwareSerial nanoSerial(9, 10);

// Motor & Safety States
int motorSpeed = 150;                  // Default conservative speed (0 to 255)
bool isMoving = false;
unsigned long moveStartTime = 0;
unsigned long moveDurationMs = 1000;   // Bounded movement duration (max 1000ms)
unsigned long lastSerialHeartbeat = 0;
const unsigned long WATCHDOG_TIMEOUT_MS = 1500; // Auto-stop if no command in 1.5s
unsigned long lastSonarTime = 0;
long currentDistanceCm = -1;

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

void roverStop() {
  setSpeeds(0);
  setMotorPins(0, 0, 0, 0, 0, 0, 0, 0);
  isMoving = false;
}

void roverForward(unsigned long duration = 1000) {
  if (currentDistanceCm > 0 && currentDistanceCm < 15) {
    Serial.println("ERR:OBSTACLE_TOO_CLOSE");
    roverStop();
    return;
  }
  setSpeeds(motorSpeed);
  setMotorPins(1, 0, 1, 0, 1, 0, 1, 0);
  isMoving = true;
  moveStartTime = millis();
  moveDurationMs = min(duration, (unsigned long)1000);
}

void roverBackward(unsigned long duration = 1000) {
  setSpeeds(motorSpeed);
  setMotorPins(0, 1, 0, 1, 0, 1, 0, 1);
  isMoving = true;
  moveStartTime = millis();
  moveDurationMs = min(duration, (unsigned long)1000);
}

void roverLeft(unsigned long duration = 600) {
  setSpeeds(motorSpeed);
  // Skid steer left: left wheels reverse, right wheels forward
  setMotorPins(0, 1, 0, 1, 1, 0, 1, 0);
  isMoving = true;
  moveStartTime = millis();
  moveDurationMs = min(duration, (unsigned long)1000);
}

void roverRight(unsigned long duration = 600) {
  setSpeeds(motorSpeed);
  // Skid steer right: left wheels forward, right wheels reverse
  setMotorPins(1, 0, 1, 0, 0, 1, 0, 1);
  isMoving = true;
  moveStartTime = millis();
  moveDurationMs = min(duration, (unsigned long)1000);
}

long measureDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 25000); // 25ms timeout (~4m max)
  if (duration == 0) return -1;
  return duration * 0.034 / 2;
}

void setup() {
  // Serial to Laptop USB or ESP32-CAM (115200 baud)
  Serial.begin(115200);

  // Serial to Arduino Nano (Robotic Arm) (9600 baud)
  nanoSerial.begin(9600);

  // Motor shield shift register control pins
  pinMode(MOTORLATCH, OUTPUT);
  pinMode(MOTORCLK, OUTPUT);
  pinMode(MOTORENABLE, OUTPUT);
  pinMode(MOTORDATA, OUTPUT);
  digitalWrite(MOTORENABLE, LOW);

  // PWM speed control pins
  pinMode(MOTOR1_PWM, OUTPUT);
  pinMode(MOTOR2_PWM, OUTPUT);
  pinMode(MOTOR3_PWM, OUTPUT);
  pinMode(MOTOR4_PWM, OUTPUT);

  // Sonar pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  roverStop();
  lastSerialHeartbeat = millis();
  Serial.println("INIT:NEXROVER_UNO_READY");
}

void loop() {
  unsigned long now = millis();

  // 1. Process incoming commands from USB Serial / ESP32-CAM
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    lastSerialHeartbeat = now;

    if (cmd == "F" || cmd.startsWith("F:")) {
      unsigned long dur = 800;
      if (cmd.startsWith("F:")) dur = constrain(cmd.substring(2).toInt(), 100, 1000);
      roverForward(dur);
      Serial.println("OK:F");
    } else if (cmd == "B" || cmd.startsWith("B:")) {
      unsigned long dur = 800;
      if (cmd.startsWith("B:")) dur = constrain(cmd.substring(2).toInt(), 100, 1000);
      roverBackward(dur);
      Serial.println("OK:B");
    } else if (cmd == "L" || cmd.startsWith("L:")) {
      unsigned long dur = 500;
      if (cmd.startsWith("L:")) dur = constrain(cmd.substring(2).toInt(), 100, 1000);
      roverLeft(dur);
      Serial.println("OK:L");
    } else if (cmd == "R" || cmd.startsWith("R:")) {
      unsigned long dur = 500;
      if (cmd.startsWith("R:")) dur = constrain(cmd.substring(2).toInt(), 100, 1000);
      roverRight(dur);
      Serial.println("OK:R");
    } else if (cmd == "S" || cmd == "STOP") {
      roverStop();
      Serial.println("OK:S");
    } else if (cmd.startsWith("V:")) {
      int spd = cmd.substring(2).toInt();
      if (spd >= 0 && spd <= 255) {
        motorSpeed = spd;
        setSpeeds(motorSpeed);
        Serial.print("OK:V:");
        Serial.println(motorSpeed);
      } else {
        Serial.println("ERR:SPEED_OUT_OF_RANGE");
      }
    } else if (cmd.startsWith("ARM:")) {
      // Forward validated arm command to Arduino Nano via SoftwareSerial
      nanoSerial.println(cmd);
      Serial.println("OK:" + cmd);
    } else if (cmd == "PING") {
      Serial.println("PONG:NEXROVER_UNO_V2");
    } else if (cmd == "STATUS") {
      Serial.print("STATUS:SPD=");
      Serial.print(motorSpeed);
      Serial.print(";DIST=");
      Serial.println(currentDistanceCm);
    } else if (cmd.length() > 0) {
      Serial.println("ERR:UNKNOWN_COMMAND");
      roverStop();
    }
  }

  // 2. Bounded Movement Duration Enforcer
  if (isMoving && (now - moveStartTime >= moveDurationMs)) {
    roverStop();
    Serial.println("OK:DURATION_COMPLETE");
  }

  // 3. Hardware Safety Watchdog (Auto-stop if serial communication drops while moving)
  if (isMoving && (now - lastSerialHeartbeat > WATCHDOG_TIMEOUT_MS)) {
    roverStop();
    Serial.println("WARN:WATCHDOG_STOP");
  }

  // 4. Sonar Obstacle Measurement & Active Safety Guard
  if (now - lastSonarTime >= 200) {
    lastSonarTime = now;
    long dist = measureDistanceCm();
    if (dist >= 0 && dist < 400) {
      currentDistanceCm = dist;
      Serial.print("DIST:");
      Serial.println(dist);

      // Active Obstacle Stop: Auto-stop immediately if obstacle is < 15cm
      if (dist < 15 && isMoving) {
        roverStop();
        Serial.println("WARN:OBSTACLE_COLLISION_PREVENTED");
      }
    }
  }
}
