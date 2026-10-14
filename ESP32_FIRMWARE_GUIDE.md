# NEX-ROVER: ESP32-CAM & Serial Bridge Firmware Integration Guide

This guide details how the **ESP32-CAM** bridges browser HTTP commands to the **Arduino UNO R3** and **Arduino Nano** controllers.

---

## 1. System Communication Architecture

```
+-------------------------------------------------------+
|  Smartphone / Browser Dashboard (Next.js)            |
|  - Drive commands, Sliders, Voice/AI terminal        |
+-------------------------------------------------------+
                           |
                     Wi-Fi (HTTP / REST)
                           |
                           v
+-------------------------------------------------------+
|  ESP32-CAM (AI-Thinker OV2640)                        |
|  - IP: 192.168.4.1 (AP Mode) or DHCP IP               |
|  - Serves MJPEG video stream on /stream               |
|  - Exposes REST endpoints (/api/drive, /api/arm, ...)  |
+-------------------------------------------------------+
                           |
              UART Serial (115200 Baud, \n terminated)
              (Note: 5V -> 3.3V logic level divider)
                           |
                           v
+-------------------------------------------------------+
|  Arduino UNO R3                                       |
|  - Controls 4 DC Motors via L293D / HW-130 Shield     |
|  - Reads HC-SR04 Ultrasonic Distance Sensor           |
|  - Relays "ARM:JOINT:ANGLE" to Nano via SoftwareSerial|
+-------------------------------------------------------+
                           |
              SoftwareSerial (9600 Baud, Pins 9 & 10)
                           |
                           v
+-------------------------------------------------------+
|  Arduino Nano                                         |
|  - Drives 4x SG90 Micro Servos                        |
|  - Base (D3), Shoulder (D5), Elbow (D6), Gripper (D9)  |
+-------------------------------------------------------+
```

---

## 2. HTTP to Serial Translation Contract

| Action | HTTP Request | Serial Sent (ESP32 -> UNO) | Serial Sent (UNO -> Nano) | Response |
| :--- | :--- | :--- | :--- | :--- |
| **Drive Forward** | `POST /api/drive {"command":"F"}` | `F\n` | — | `{"success":true,"command":"F"}` |
| **Drive Backward** | `POST /api/drive {"command":"B"}` | `B\n` | — | `{"success":true,"command":"B"}` |
| **Turn Left** | `POST /api/drive {"command":"L"}` | `L\n` | — | `{"success":true,"command":"L"}` |
| **Turn Right** | `POST /api/drive {"command":"R"}` | `R\n` | — | `{"success":true,"command":"R"}` |
| **Stop Motors** | `POST /api/drive {"command":"S"}` | `S\n` | — | `{"success":true,"command":"S"}` |
| **Set Speed** | `POST /api/drive {"command":"V:180"}` | `V:180\n` | — | `{"success":true,"command":"V:180"}` |
| **Move Arm Joint** | `POST /api/arm {"joint":"BASE","angle":90}` | `ARM:BASE:90\n` | `ARM:BASE:90\n` | `{"success":true,"command":"ARM:BASE:90"}` |
| **Health Check** | `GET /api/status` | `PING\n` | — | `{"connected":true,"obstacleDistanceCm":42,...}` |

---

## 3. Electrical Wiring & Critical Voltage Safety

> [!WARNING]
> **ESP32-CAM runs on 3.3V logic!** While it is powered by 5V on its 5V pin, its GPIO pins (including RX) are NOT 5V-tolerant. 
> Direct connection from Arduino UNO TX (5V) to ESP32 RX will degrade or destroy the ESP32.

### Pinout Matrix:

1. **ESP32-CAM to Arduino UNO:**
   - **ESP32 5V** -> External 5V 2A Power Source (or UNO 5V if current permits)
   - **ESP32 GND** -> Common GND (MUST be shared across UNO, Nano, ESP32, and Battery)
   - **ESP32 TX (GPIO 1)** -> **UNO RX (Pin 0)** (Direct connection is safe: 3.3V HIGH is read as HIGH by UNO)
   - **UNO TX (Pin 1)** -> **Voltage Divider** -> **ESP32 RX (GPIO 3)**:
     - Connect UNO TX to a 1kΩ resistor.
     - Connect other end of 1kΩ resistor to ESP32 RX and a 2kΩ resistor to GND. (5V * 2k / 3k = 3.33V).

2. **Arduino UNO to HC-SR04 Ultrasonic Sensor:**
   - **VCC** -> 5V
   - **GND** -> GND
   - **Trig** -> UNO Analog Pin `A1`
   - **Echo** -> UNO Analog Pin `A2`

3. **Arduino UNO to Arduino Nano (Robotic Arm Link):**
   - **UNO Pin 10 (TX)** -> **Nano Pin D0 (RX)**
   - **UNO Pin 9 (RX)** <- **Nano Pin D1 (TX)**
   - **Common GND**

4. **Arduino Nano to 4x SG90 Servos:**
   - **Base Servo:** Signal -> Pin `D3`
   - **Shoulder Servo:** Signal -> Pin `D5`
   - **Elbow Servo:** Signal -> Pin `D6`
   - **Gripper Servo:** Signal -> Pin `D9`
   - **Servo Power (Red) & Ground (Brown):** Connect to dedicated 5V 3A buck converter (LM2596). **Never power 4 servos directly from Arduino 5V pin**, as servo current spikes will reset the microcontroller!

---

## 4. Flashing Instructions

### Requirements:
- **Arduino IDE 2.x** or **PlatformIO**
- ESP32 Board package by Espressif (`https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`)
- **ArduinoJson** library by Benoît Blanchon (install from Library Manager)

### Flashing the ESP32-CAM:
1. Connect ESP32-CAM to an FTDI USB-to-UART programmer:
   - FTDI 5V -> ESP32 5V
   - FTDI GND -> ESP32 GND
   - FTDI TX -> ESP32 U0R (RX)
   - FTDI RX -> ESP32 U0T (TX)
2. **Bridge `GPIO 0` to `GND`** on the ESP32-CAM to enter bootloader mode.
3. In Arduino IDE:
   - Select Board: `AI Thinker ESP32-CAM`
   - CPU Frequency: `240MHz`
   - Flash Frequency: `80MHz`
   - Upload Speed: `115200`
4. Open [esp32_cam_nexrover.ino](file:///firmware/esp32_cam/esp32_cam_nexrover.ino).
5. Click **Upload**. When "Connecting..." appears in the serial monitor, press the RST button on the ESP32-CAM.
6. Once upload finishes, **disconnect GPIO 0 from GND** and press RST to boot normal firmware.

### Flashing the Arduino UNO:
1. Open [arduino_uno_nexrover.ino](file:///firmware/arduino_uno/arduino_uno_nexrover.ino).
2. Select Board: `Arduino Uno`, select COM port, and click **Upload**.

### Flashing the Arduino Nano:
1. Open [arduino_nano_arm.ino](file:///firmware/arduino_nano/arduino_nano_arm.ino).
2. Select Board: `Arduino Nano`, Processor: `ATmega328P` (or `ATmega328P (Old Bootloader)`), and click **Upload**.

---

## 5. Verification & Diagnostics

1. Power on the robot. Check Wi-Fi networks on your phone or PC for **`NEX-ROVER-WIFI`** (Password: `rover1234`).
2. Open your browser and navigate to `http://192.168.4.1/api/status`. You should receive:
   ```json
   {
     "connected": true,
     "currentSpeed": 160,
     "lastCommand": "S",
     "firmwareVersion": "NEX-ESP32-1.0",
     "obstacleDistanceCm": 45
   }
   ```
3. Test motor drive command:
   ```bash
   curl -X POST http://192.168.4.1/api/drive -H "Content-Type: application/json" -d '{"command":"F"}'
   ```
4. Test arm servo command:
   ```bash
   curl -X POST http://192.168.4.1/api/arm -H "Content-Type: application/json" -d '{"joint":"BASE","angle":90}'
   ```
