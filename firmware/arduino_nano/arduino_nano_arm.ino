/**
 * NEX-ROVER: Arduino Nano 4-DOF Robotic Arm Controller
 *
 * Receives serial commands forwarded from Arduino UNO:
 *   - "ARM:BASE:90"
 *   - "ARM:SHOULDER:90"
 *   - "ARM:ELBOW:90"
 *   - "ARM:GRIPPER:60"
 *
 * Controls 4 SG90 micro-servos:
 *   - Pin D3: Base Servo (0° to 180°)
 *   - Pin D5: Shoulder Servo (0° to 180°)
 *   - Pin D6: Elbow Servo (0° to 180°)
 *   - Pin D9: Gripper Clamp Servo (0° to 180°)
 */

#include <Servo.h>

Servo servoBase;
Servo servoShoulder;
Servo servoElbow;
Servo servoGripper;

const int PIN_BASE     = 3;
const int PIN_SHOULDER = 5;
const int PIN_ELBOW    = 6;
const int PIN_GRIPPER  = 9;

// Target and current angles for smooth interpolation
int currentBase = 90, targetBase = 90;
int currentShoulder = 90, targetShoulder = 90;
int currentElbow = 90, targetElbow = 90;
int currentGripper = 60, targetGripper = 60;

unsigned long lastStepTime = 0;
const int STEP_DELAY_MS = 15; // Smooth movement speed

void stepServos() {
  if (millis() - lastStepTime < STEP_DELAY_MS) return;
  lastStepTime = millis();

  if (currentBase < targetBase) currentBase++;
  else if (currentBase > targetBase) currentBase--;
  servoBase.write(currentBase);

  if (currentShoulder < targetShoulder) currentShoulder++;
  else if (currentShoulder > targetShoulder) currentShoulder--;
  servoShoulder.write(currentShoulder);

  if (currentElbow < targetElbow) currentElbow++;
  else if (currentElbow > targetElbow) currentElbow--;
  servoElbow.write(currentElbow);

  if (currentGripper < targetGripper) currentGripper++;
  else if (currentGripper > targetGripper) currentGripper--;
  servoGripper.write(currentGripper);
}

void setup() {
  Serial.begin(9600);

  servoBase.attach(PIN_BASE);
  servoShoulder.attach(PIN_SHOULDER);
  servoElbow.attach(PIN_ELBOW);
  servoGripper.attach(PIN_GRIPPER);

  // Set default initial neutral park pose
  servoBase.write(currentBase);
  servoShoulder.write(currentShoulder);
  servoElbow.write(currentElbow);
  servoGripper.write(currentGripper);
}

void loop() {
  // Read commands formatted as "ARM:JOINT:ANGLE\n"
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();

    if (line.startsWith("ARM:")) {
      int firstColon = line.indexOf(':');
      int secondColon = line.indexOf(':', firstColon + 1);

      if (secondColon > 0) {
        String joint = line.substring(firstColon + 1, secondColon);
        int angle = constrain(line.substring(secondColon + 1).toInt(), 0, 180);

        if (joint == "BASE") targetBase = angle;
        else if (joint == "SHOULDER") targetShoulder = angle;
        else if (joint == "ELBOW") targetElbow = angle;
        else if (joint == "GRIPPER") targetGripper = angle;
      }
    }
  }

  // Smoothly step servos to target
  stepServos();
}
