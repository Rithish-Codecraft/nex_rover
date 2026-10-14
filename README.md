# NEX-ROVER — Mobile Robot Control Dashboard & AI Vision System

[![Vercel Deployment](https://img.shields.io/badge/Deployed_on-Vercel-black?style=for-the-badge&logo=vercel)](https://nex-rover-sigma.vercel.app)
**Live Production Dashboard**: [https://nex-rover-sigma.vercel.app](https://nex-rover-sigma.vercel.app)  
**Dedicated Mobile Broadcaster**: [https://nex-rover-sigma.vercel.app/camera](https://nex-rover-sigma.vercel.app/camera)  
**GitHub Repository**: [https://github.com/Rithish-Codecraft/nex_rover](https://github.com/Rithish-Codecraft/nex_rover)

A complete, production-grade robotics control and AI vision perception system for **NEX-ROVER**, a four-wheel-drive rover with a 4-DOF robotic arm. Built with Next.js 16 (Turbopack), Google Gemini Vision AI, Python local hardware bridge (USB serial & ESP32-CAM Wi-Fi), and Arduino firmware (UNO R3 + Nano).

---

## 1. End-to-End System Architecture

```
+-----------------------------------------------------------------------------------------+
|  Mobile Phone Camera (Mounted on Rover Chassis)                                         |
|  - Opened over HTTPS at /camera                                                         |
|  - getUserMedia({ facingMode: "environment" }) rear camera feed                         |
|  - Continuous / on-demand frame capture (JPEG)                                          |
|  - Relays low-latency preview snapshots to laptop dashboard via /api/camera/stream      |
+-----------------------------------------------------------------------------------------+
                                         |
                            HTTPS POST /api/vision
                                         v
+-----------------------------------------------------------------------------------------+
|  Vercel Server-Side AI Vision API (/api/vision)                                         |
|  - Vision-capable Google Gemini Model (GEMINI_API_KEY never exposed to browser)         |
|  - Validates MIME type, file size (< 4MB), rate limits & timeouts                       |
|  - Strict JSON schema validation:                                                       |
|    * sceneSummary: concise terrain & foreground description                             |
|    * detectedObjects: [{ label, direction, distanceEstimate, confidence }]              |
|    * hazards: ["list of identified hazards"]                                            |
|    * recommendedAction: "stop" | "forward" | "backward" | "left" | "right" | "arm_action" |
|    * movement: { direction, speedPercent, durationMs <= 1000ms }                        |
|    * armAction: { joint: "BASE"|"SHOULDER"|"ELBOW"|"GRIPPER", angle: 0-180 } | null     |
|    * requiresApproval: true (Operator Approval Gate enforced)                           |
+-----------------------------------------------------------------------------------------+
                                         |
                            Structured Recommendation
                                         v
+-----------------------------------------------------------------------------------------+
|  Central Safety Command Arbiter (Laptop Dashboard)                                      |
|  - Priority 1: Emergency Stop (Always executes immediately, halts all motors)           |
|  - Priority 2: Manual Operator Control (D-Pad, WASD keys, Arm Sliders)                  |
|  - Priority 3: Safety Interlocks (Ultrasonic Sonar < 20cm blocks forward movement)      |
|  - Priority 4: Approved AI / Autonomous Action (Bounded <= 1000ms duration)             |
+-----------------------------------------------------------------------------------------+
                                         |
                            POST /api/relay (X-Rover-Token)
                                         v
+-----------------------------------------------------------------------------------------+
|  Laptop Local Hardware Bridge (pc_backend/app.py on 127.0.0.1:5000)                     |
|  - Validates allowlisted commands & enforces timeouts                                   |
|  - Dual Communication Routes:                                                           |
|    * ROUTE A: Direct USB Serial Port to Arduino UNO (COM14 / /dev/ttyACM0 @ 115200 baud)|
|    * ROUTE B: ESP32-CAM Wi-Fi Bridge (HTTP REST to 192.168.4.1)                         |
|    * ROUTE C: Clearly labeled SIMULATION mode (when physical hardware is offline)       |
+-----------------------------------------------------------------------------------------+
                                         |
                            Serial 115200 baud / USB Cable
                                         v
+-----------------------------------------------------------------------------------------+
|  Arduino UNO R3 Controller (firmware/arduino_uno/)                                      |
|  - HW-130 / L293D Motor Shield (4 DC motors)                                            |
|  - Hardware Command Watchdog: auto-stops motors if communication drops > 1500ms         |
|  - Bounded duration: auto-stops after <= 1000ms per step                                |
|  - Local Sonar Safety: stops forward drive if obstacle < 15cm                           |
|  - Explicit acknowledgements: OK:F, OK:B, OK:S, OK:V, OK:ARM, PONG, ERR                 |
|  - Relays "ARM:JOINT:ANGLE" to Nano via SoftwareSerial (Pins 9 & 10 @ 9600 baud)        |
+-----------------------------------------------------------------------------------------+
                                         |
                            SoftwareSerial @ 9600 baud
                                         v
+-----------------------------------------------------------------------------------------+
|  Arduino Nano Controller (firmware/arduino_nano/)                                       |
|  - Controls 4x SG90 Servos: Base (D3), Shoulder (D5), Elbow (D6), Gripper (D9)          |
|  - Smooth kinematic interpolation to prevent mechanical gear stripping                 |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Key Modules & Capabilities

### A. Dedicated Mobile Broadcaster (`/camera`)
- **Direct Mobile URL**: Access `/camera` on your smartphone browser over HTTPS.
- **Rear Camera Default**: Automatically opens the device's rear-facing camera (`facingMode: { ideal: "environment" }`) with quick lens-switching support.
- **Continuous Vision Analysis**: Configurable auto-analyze cycle (3s, 5s, 10s intervals) with live countdown progress.
- **Laptop Feed Relay**: Transmits lightweight preview snapshots to `/api/camera/stream` so the laptop dashboard can view the rover's camera view.
- **Screen WakeLock**: Employs the Screen WakeLock API to keep the phone screen active while mounted on the rover.

### B. Laptop Dashboard (`/`)
- **Dual Camera Feeds**:
  - `Rover Phone Cam`: Live relayed preview snapshots from the phone mounted on the rover with latency indicators.
  - `Local Device Cam`: Direct laptop webcam.
  - `ESP32 Stream`: MJPEG video feed from the ESP32-CAM module.
- **AI Perception Card**: Displays full scene summary, detected objects (with direction badges, distance estimates, and confidence scores), hazards list, and reasoning.
- **Operator Approval Gate**: In **Approval Mode**, physical motion is only dispatched when the human operator clicks **Approve & Execute**.
- **Tactical Mode Switcher**:
  - `Manual Mode`: Direct manual driving with keyboard shortcuts and D-pad.
  - `Approval Gate`: Human-in-the-loop validation for every AI suggestion.
  - `Autonomous Exploration`: Safety-gated automated cycles bounded by 1000ms duration and obstacle checks.
- **Direct USB Serial Manager**: Scan available COM ports on the laptop, configure baud rate (115200 default), and connect/disconnect directly to the Arduino UNO.

### C. Local PC Hardware Bridge (`pc_backend/app.py`)
- Python service using `Flask`, `Flask-CORS`, and `pyserial`.
- Enumerates serial ports (`GET /api/ports`).
- Connects safely to USB COM ports (`POST /api/serial/connect`).
- Strictly validates all commands against an allowlist before transmitting over serial.
- Listens asynchronously for Arduino distance reports (`DIST:<cm>`) and acknowledgements (`OK:F`, `OK:S`, `PONG`).
- Fallback to ESP32-CAM HTTP bridge or clearly labeled `SIMULATION` mode.

### D. Firmware Protocol & Safety
- **Bounded Movement Duration**: Firmware enforces a maximum duration of 1000 ms per command. Movements auto-stop unless continuously refreshed.
- **Command Watchdog**: If communication drops for > 1500 ms while the rover is in motion, the Arduino immediately shuts off all motor PWM signals (`WARN:WATCHDOG_STOP`).
- **Obstacle Proximity Protection**: If the HC-SR04 ultrasonic sensor reads `< 15 cm`, forward drive is blocked automatically (`ERR:OBSTACLE_TOO_CLOSE`).

---

## 3. Configuration & Environment Variables

Copy `.env.example` to `.env.local` for local Next.js development:
```bash
cp .env.example .env.local
```

### Environment Variables Reference

| Variable | Scope | Description | Example |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | Cloud (Server-only) | Google Gemini API Key for vision analysis | `AIzaSy...` |
| `GEMINI_MODEL` | Cloud (Server-only) | Gemini vision model identifier | `gemini-1.5-flash` |
| `PC_BACKEND_URL` | Cloud / Dashboard | Local PC controller URL | `http://127.0.0.1:5000` |
| `ROVER_TOKEN` | Server / PC Backend | Shared secret token for authenticated relay | `rover_secret_token_123` |
| `ARDUINO_PORT` | PC Backend | Serial port for USB cable to Arduino UNO | `COM14` or `/dev/ttyACM0` |
| `ARDUINO_BAUD` | PC Backend | Serial baud rate for Arduino UNO | `115200` |
| `ESP32_URL` | PC Backend | Optional ESP32-CAM address for Wi-Fi bridge | `http://192.168.4.1` |

---

## 4. Physical Wiring & Connection Guide

### Option 1: Direct USB Cable (Laptop to Arduino UNO) — Recommended
Connect a standard USB Type-A to Type-B cable directly from your laptop to the Arduino UNO.
- The PC backend (`pc_backend/app.py`) opens the serial port (e.g. `COM14`) at **115200 baud**.
- Zero network latency, immune to Wi-Fi interference.

### Option 2: ESP32-CAM Wi-Fi Bridge to Arduino UNO
Connect the ESP32-CAM to the Arduino UNO via hardware UART:

| Pin on ESP32-CAM | Connection | Pin on Arduino UNO | Description |
| :--- | :--- | :--- | :--- |
| `GND` | Shared Ground | `GND` | Common ground rail (Critical!) |
| `GPIO 1 (TX)` | Direct Wire | `Pin 0 (RX)` | ESP32 TX (3.3V) to UNO RX |
| `GPIO 3 (RX)` | **Voltage Divider** | `Pin 1 (TX)` | UNO TX (5V) to ESP32 RX (3.3V) |

> **Voltage Divider**: Place a 1kΩ resistor between UNO TX and ESP32 RX, and a 2kΩ resistor between ESP32 RX and GND.

### Robotic Arm & Motors Pinout
| Board | Pin | Target | Notes |
| :--- | :--- | :--- | :--- |
| **Arduino UNO** | `Pin 10 (TX)` | **Arduino Nano** `Pin D0 (RX)` | 9600 baud SoftwareSerial |
| **Arduino UNO** | `Pin 9 (RX)` | **Arduino Nano** `Pin D1 (TX)` | 9600 baud SoftwareSerial |
| **Arduino UNO** | `Trig (A1)` | **HC-SR04** `Trig` | Ultrasonic trigger pulse |
| **Arduino UNO** | `Echo (A2)` | **HC-SR04** `Echo` | Ultrasonic echo return |
| **Arduino Nano** | `D3` | **Base Servo** | SG90 0°–180° |
| **Arduino Nano** | `D5` | **Shoulder Servo** | SG90 0°–180° |
| **Arduino Nano** | `D6` | **Elbow Servo** | SG90 0°–180° |
| **Arduino Nano** | `D9` | **Gripper Servo** | SG90 0°–180° |
| **Servos** | `VCC (Red)` | **Buck Converter** | Dedicated 5V 3A (Never power from Nano!) |

---

## 5. Running the System Locally

### Step 1: Start Next.js Dashboard
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) on your laptop.

### Step 2: Start Python PC Hardware Bridge
```bash
cd pc_backend
pip install -r requirements.txt
python app.py
```
The hardware bridge will launch on `http://127.0.0.1:5000` and detect available serial ports (e.g. `COM14`).

### Step 3: Run Automated Tests
```bash
npm run test
```
Runs unit tests for command validation, duration limit clamping, servo angle safety bounds, and the 4-tier safety command arbiter.

---

## 6. Verification Checklist

1. [x] **Phone Camera Access**: Opens `/camera` over HTTPS with rear-facing camera preview.
2. [x] **Phone-to-Laptop Relay**: Laptop dashboard displays the relayed mobile camera feed with age/latency monitoring.
3. [x] **AI Vision Schema**: Server-side Gemini API returns structured objects, directions, hazards, and bounded movement commands.
4. [x] **Operator Approval Gate**: Physical movement requires operator approval in Approval Mode.
5. [x] **Emergency STOP**: E-STOP immediately overrides all queues and stops motors.
6. [x] **USB Serial Hardware Bridge**: `pc_backend/app.py` communicates directly with Arduino UNO at 115200 baud.
7. [x] **Firmware Watchdog**: Arduino UNO auto-stops if communication lapses > 1500 ms or obstacle is < 15 cm.
8. [x] **Zero Secrets in Source**: All API keys and secrets stored server-side in environment variables.

---

## 7. License

MIT License. Developed for the SBU Hackathon.
