# NEX-ROVER — Mobile Robot Control Dashboard

[![Vercel Deployment](https://img.shields.io/badge/Deployed_on-Vercel-black?style=for-the-badge&logo=vercel)](https://nex-rover-sigma.vercel.app)
**Live Production Dashboard**: [https://nex-rover-sigma.vercel.app](https://nex-rover-sigma.vercel.app)  
**GitHub Repository**: [https://github.com/Rithish-Codecraft/nex_rover](https://github.com/Rithish-Codecraft/nex_rover)

A dark, futuristic, mobile-first robotics dashboard and AI copilot for **NEX-ROVER**, a four-wheel-drive rover with a 4-DOF robotic arm, mobile rear-camera Gemini AI vision, authenticated PC backend command relay, and ESP32-CAM UART bridge to Arduino UNO & Nano.

---

## 1. End-to-End System Architecture

```
+-------------------------------------------------------------------------------+
|  Operator Smartphone (Mounted on Rover or Handheld)                           |
|  - High-res rear camera preview via getUserMedia()                            |
|  - On-demand "Capture Frame" action (JPEG/WebP)                               |
|  - Tactical Web Dashboard on Next.js (HTTPS)                                  |
+-------------------------------------------------------------------------------+
                                     |
                       HTTPS POST /api/vision (Image Payload)
                                     v
+-------------------------------------------------------------------------------+
|  Next.js Server API (Vercel / Cloud)                                          |
|  - Google Gemini Vision (generateContent API via GEMINI_API_KEY)              |
|  - Strict JSON schema validation: sceneSummary, hazards, recommendedAction    |
|  - Max 1000ms duration & speed clamping (0-255)                               |
+-------------------------------------------------------------------------------+
                                     |
                       Structured Recommendation (STOP / FORWARD / ARM...)
                                     v
+-------------------------------------------------------------------------------+
|  Operator Approval Gate (UI)                                                  |
|  - Human-in-the-loop: Action NEVER executes without explicit operator approval |
|  - Approve Action / Reject Action buttons + Immediate Emergency STOP         |
+-------------------------------------------------------------------------------+
                                     |
                       POST /api/relay (Authenticated with X-Rover-Token)
                                     v
+-------------------------------------------------------------------------------+
|  PC Backend Command Relay (pc_backend/app.py on Operator LAN)                 |
|  - Bridges cloud HTTPS to local robot Wi-Fi network                           |
|  - Validates allowlisted commands & enforces timeouts                         |
+-------------------------------------------------------------------------------+
                                     |
                       HTTP REST (Wi-Fi 802.11 b/g/n)
                                     v
+-------------------------------------------------------------------------------+
|  ESP32-CAM Wi-Fi Command Bridge (firmware/esp32_cam/)                        |
|  - IP: 192.168.4.1 (SoftAP: NEX-ROVER-WIFI)                                   |
|  - Translates /api/drive and /api/arm to UART Serial @ 115200 baud             |
+-------------------------------------------------------------------------------+
                                     |
                       Hardware UART (Level-Shifted 3.3V <-> 5V)
                                     v
+-------------------------------------------------------------------------------+
|  Arduino UNO R3 (firmware/arduino_uno/)                                       |
|  - HW-130 / L293D 4WD Motor Shield (M1, M2, M3, M4)                           |
|  - HC-SR04 Ultrasonic Sonar Telemetry (Trig A1, Echo A2)                      |
|  - Relays "ARM:JOINT:ANGLE" to Nano via SoftwareSerial (9600 baud, Pins 9/10) |
+-------------------------------------------------------------------------------+
                                     |
                       SoftwareSerial @ 9600 baud
                                     v
+-------------------------------------------------------------------------------+
|  Arduino Nano (firmware/arduino_nano/)                                        |
|  - Controls 4x SG90 Servos: Base (D3), Shoulder (D5), Elbow (D6), Gripper (D9)|
|  - Smooth kinematic interpolation to prevent mechanical gear stripping        |
+-------------------------------------------------------------------------------+
```

---

## 2. Key Features

- **Mobile Rear-Camera Gemini Vision AI**:
  - Live video stream using the phone's native rear camera (`facingMode: "environment"`).
  - Explicit **Capture Frame** snapshot button with shutter flash animation.
  - Submits frames directly to `/api/vision` powered by Google Gemini.
  - Identifies detected objects, surface hazards, drops, obstacles, and recommends incremental safe actions.
- **Operator Approval Gate (Human-in-the-Loop)**:
  - Movements are **never automatically executed**.
  - Operator inspects scene summary, hazards, speed, and duration before pressing **Approve & Execute** or **Reject**.
- **Safe Command Relay**:
  - All approved movements are bounded to a maximum of **1000 ms** duration.
  - Automatically issues a stop (`S`) command when the duration expires.
  - Routes requests via the authenticated Python PC backend (`pc_backend/`) to bridge HTTPS and local HTTP without mixed-content browser blocks.
- **Emergency STOP (E-STOP)**:
  - Prominent emergency stop button available on all screens.
  - Immediately aborts active AI operations and motor drives.
- **Tactical Dashboard & Manual Controls**:
  - 4-way ergonomic drive pad with hold-to-drive auto-stop and keyboard shortcuts (`WASD`/arrows).
  - PWM motor throttle slider (0–255) with *Crawl (90)*, *Cruise (160)*, and *Turbo (255)* presets.
  - 4-DOF robotic arm sliders with live kinematic vector SVG visualizer.
  - Voice controller with real-time speech recognition and audio speech feedback.
  - Live ultrasonic distance gauge (HC-SR04) with collision alert (< 20 cm).
  - Built-in simulation mode for testing when hardware is offline.

---

## 3. Configuration & Environment Variables

Copy `.env.example` to `.env.local` for local development:
```bash
cp .env.example .env.local
```

### Environment Variables Table

| Variable | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini API Key for vision analysis | **Yes** (for AI Vision) | `AIzaSy...` |
| `GEMINI_MODEL` | Gemini Model identifier | No (default: `gemini-1.5-flash`) | `gemini-1.5-flash` |
| `PC_BACKEND_URL` | Local PC relay URL | **Yes** (for HTTPS hardware relay) | `http://127.0.0.1:5000` |
| `ROVER_TOKEN` | Shared secret token between dashboard & PC backend | **Yes** (for relay auth) | `rover_secret_token_123` |
| `ROBOT_ENDPOINT` | Direct ESP32-CAM address | No (default: `http://192.168.4.1`) | `http://192.168.4.1` |
| `CAMERA_STREAM_URL`| ESP32-CAM stream URL | No | `http://192.168.4.1:81/stream` |

### Setting Environment Variables in Vercel
1. Open your project on Vercel: [https://vercel.com/rithishcodecraft-4430s-projects/nex-rover/settings/environment-variables](https://vercel.com/rithishcodecraft-4430s-projects/nex-rover/settings/environment-variables)
2. Add:
   - `GEMINI_API_KEY` = `your_api_key`
   - `GEMINI_MODEL` = `gemini-1.5-flash`
   - `ROVER_TOKEN` = `your_secret_token`
   - `PC_BACKEND_URL` = `http://<your_pc_lan_ip>:5000` (or leave default if testing via local tunnel)
3. Redeploy or push a new commit to apply.

---

## 4. PC Backend Relay Setup (`pc_backend/`)

The Python Flask backend runs on the operator's laptop/PC (connected to the same Wi-Fi as the ESP32 rover) to safely receive commands from the cloud dashboard and forward them to the rover.

```bash
cd pc_backend

# 1. Create and activate Python virtual environment
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env with your settings:
# ESP32_URL=http://192.168.4.1
# ROVER_TOKEN=your_secure_rover_secret_token_here
# PORT=5000

# 4. Start the backend
python app.py
```

The PC backend will start on `http://127.0.0.1:5000`. Test health:
```bash
curl http://127.0.0.1:5000/health
# Response: {"ok": true, "service": "nex-rover-pc-backend", "esp32_configured": true}
```

---

## 5. Hardware UART Wiring & Pinout Guide

> [!WARNING]
> **ESP32-CAM uses 3.3V logic!** Connecting Arduino UNO TX (5V) directly to ESP32-CAM RX (3.3V) can damage the ESP32. Use a 1kΩ / 2kΩ resistor voltage divider.

### Hardware Interconnect Table

| From Component | Pin | To Component | Pin | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **ESP32-CAM** | `TX (GPIO 1)` | **Arduino UNO** | `RX (Pin 0)` | **115200 baud** (Direct connection is safe) |
| **Arduino UNO** | `TX (Pin 1)` | **Voltage Divider** | `1kΩ resistor` | 5V side |
| **Voltage Divider** | `1kΩ / 2kΩ tap`| **ESP32-CAM** | `RX (GPIO 3)` | Steps down 5V to **3.33V** |
| **ESP32-CAM** | `GND` | **Arduino UNO** | `GND` | **Common Ground is MANDATORY** |
| **ESP32-CAM** | `5V` | **External 5V Power**| `5V 2A` | Do not power ESP32 from UNO 3.3V |
| **Arduino UNO** | `Pin 10 (TX)` | **Arduino Nano** | `RX (Pin D0)` | **9600 baud** (Arm command relay) |
| **Arduino UNO** | `Pin 9 (RX)` | **Arduino Nano** | `TX (Pin D1)` | **9600 baud** |
| **Arduino UNO** | `Trig (Pin A1)`| **HC-SR04** | `Trig` | Ultrasonic trigger |
| **Arduino UNO** | `Echo (Pin A2)`| **HC-SR04** | `Echo` | Ultrasonic echo |
| **Arduino Nano** | `Pin D3` | **Base Servo** | Signal (Orange) | SG90 0°–180° |
| **Arduino Nano** | `Pin D5` | **Shoulder Servo**| Signal (Orange) | SG90 0°–180° |
| **Arduino Nano** | `Pin D6` | **Elbow Servo** | Signal (Orange) | SG90 0°–180° |
| **Arduino Nano** | `Pin D9` | **Gripper Servo** | Signal (Orange) | SG90 0°–180° |
| **Servos (All 4)**| `VCC (Red)` | **Buck Converter**| `5V 3A Out` | **Never power 4 servos from Nano 5V pin!** |

---

## 6. Pre-Flight Hardware Verification Checklist

Before running autonomous or vision-assisted movements, complete this checklist:

1. [ ] **Common Ground**: Verify a single shared ground wire connects the battery negative, ESP32 GND, UNO GND, and Nano GND.
2. [ ] **Voltage Divider on ESP32 RX**: Confirm 1kΩ in series from UNO TX to ESP32 RX, and 2kΩ from ESP32 RX to GND.
3. [ ] **Servo Power Supply**: Ensure all 4 SG90 servos are powered from a separate 5V 3A buck converter (e.g. LM2596), not the Arduino's 5V pin.
4. [ ] **Motor Shield Power**: Verify the HW-130 / L293D shield receives dedicated battery power on its `EXT_PWR` terminals with the power jumper removed if exceeding 9V.
5. [ ] **ESP32-CAM Boot State**: Confirm `GPIO 0` is disconnected from `GND` so the ESP32 boots in normal operational mode.
6. [ ] **SoftAP Verification**: Connect phone or PC Wi-Fi to **`NEX-ROVER-WIFI`** (password: `rover1234`).
7. [ ] **Serial Diagnostics**: Verify Arduino UNO serial baud rate matches `115200` and Nano matches `9600`.
8. [ ] **Sonar Obstacle Test**: Place a hand 15 cm in front of the HC-SR04 sonar; verify the dashboard displays proximity warning.

---

## 7. Step-by-Step Test Procedure for Mobile-Camera Gemini AI

1. Open the dashboard on your smartphone over HTTPS: [https://nex-rover-sigma.vercel.app](https://nex-rover-sigma.vercel.app)
2. Switch to the **"Phone Cam"** tab in the camera panel.
3. Tap **"Enable Rear Camera"** and grant browser camera permissions.
4. Point the smartphone's camera at the terrain in front of the rover.
5. Tap **"Capture Frame for Gemini AI"**. Notice the shutter flash and frame thumbnail preview.
6. (Optional) Adjust the task prompt (e.g., *"Inspect path for obstacles and suggest safe detour"*).
7. Tap **"Analyze with Gemini"**. The server endpoint `/api/vision` queries Gemini and validates the JSON output.
8. Review the results:
   - **Scene Assessment** and **Detected Objects**.
   - **Hazards & Constraints** (highlighted in red if drop-offs, stairs, or obstacles are present).
   - **Recommended Action** (e.g. `FORWARD [600ms, Speed: 130]`).
9. Notice the **Operator Approval Required** banner. The robot remains stationary until you take action.
10. Tap **"Approve & Execute"** to transmit the command through the authenticated relay to the rover.
11. Tap **"E-STOP"** at any time to immediately interrupt any active motion.

---

## 8. License

MIT License. Built for the SBU Hackathon.
