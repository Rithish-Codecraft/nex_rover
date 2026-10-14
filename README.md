# NEX-ROVER — Mobile Robot Control Dashboard

[![Vercel Deployment](https://img.shields.io/badge/Deployed_on-Vercel-black?style=for-the-badge&logo=vercel)](https://nex-rover-sigma.vercel.app)
**Live Dashboard**: [https://nex-rover-sigma.vercel.app](https://nex-rover-sigma.vercel.app)

A dark, futuristic, mobile-first web dashboard for **NEX-ROVER**, a four-wheel-drive robotic rover featuring a 4-DOF robotic arm, ESP32-CAM video stream, phone camera preview, ultrasonic obstacle detection, and natural-language AI voice control.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |       Operator Smartphone / PC        |
                      | Next.js Mobile-First Web Dashboard   |
                      | - Phone Rear Cam / ESP32-CAM Viewport |
                      | - 4-Way D-Pad + Speed Slider (0-255)  |
                      | - 4-DOF Arm Kinematics & Poses        |
                      | - Voice Commands (Speech Recognition) |
                      | - AI Command Terminal (Safe Proxy)    |
                      +---------------------------------------+
                                          |
                         HTTP / REST API (Wi-Fi 802.11)
                                          |
                                          v
                      +---------------------------------------+
                      |         ESP32-CAM Module              |
                      | - IP: 192.168.4.1 (or Local DHCP)     |
                      | - MJPEG Stream on /stream             |
                      | - Translates REST to Serial @ 115200  |
                      +---------------------------------------+
                                          |
                         Serial UART (Level-Shifted 3.3V)
                                          |
                                          v
                      +---------------------------------------+
                      |          Arduino UNO R3               |
                      | - HW-130 / L293D 4WD Motor Shield     |
                      | - HC-SR04 Ultrasonic Sonar Telemetry  |
                      +---------------------------------------+
                                          |
                                 SoftwareSerial (9600)
                                          |
                                          v
                      +---------------------------------------+
                      |          Arduino Nano                 |
                      | - 4x SG90 Micro-Servos (Base,         |
                      |   Shoulder, Elbow, Gripper)           |
                      +---------------------------------------+
```

---

## Features

- **Futuristic Tactical UI**: Dark cybersecurity / robotics design crafted for hackathon presentations and field operations.
- **Dual Camera Viewport**: Seamlessly toggle between the robot's **ESP32-CAM stream** and the smartphone's **rear camera** using `navigator.mediaDevices.getUserMedia()`.
- **4-Way Ergonomic D-Pad**: Touch and keyboard (WASD / Arrows) drive pad with **Hold-to-Drive** auto-stop and Center Stop.
- **Precision PWM Motor Throttle**: 0-255 speed slider with Crawl (90), Cruise (160), and Turbo (255) presets.
- **4-DOF Robotic Arm Control**:
  - Independent angle sliders (0°-180°) for **Base**, **Shoulder**, **Elbow**, and **Gripper**.
  - Interactive SVG **kinematic visualizer** showing real-time arm posture.
  - Preset poses: *Park/Fold*, *Reach Forward*, *Pick Object*, *Grip Close*, *Wave Hello*.
- **Live Sonar & Telemetry**: HC-SR04 obstacle distance indicator with radar gauge and automated collision alert (< 20 cm).
- **Voice & Speech Control**:
  - Real-time speech-to-text using the Web Speech API.
  - Voice audio feedback through browser speech synthesis.
- **Natural Language AI Terminal**:
  - Predefined safe schema validation preventing arbitrary command execution.
  - Offline zero-latency deterministic parser fallback for unreliable hackathon Wi-Fi.
  - Cloud LLM proxy support (Google Gemini / OpenAI).
- **Zero-Hardware Simulation Mode**: Fully functional simulation engine for judges and testers without requiring physical hardware.
- **Instant Emergency STOP**: Dedicated high-priority E-Stop halting all actuators instantly.

---

## Getting Started

### Prerequisites

- **Node.js** v18+ or v20+
- **npm** or **pnpm**

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/nex-rover.git
cd nex-rover

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local
```

### Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Testing on Physical Smartphone & HTTPS Deployment

Modern mobile browsers (Chrome on Android, Safari on iOS) **require a secure context (HTTPS or localhost)** to grant access to the rear camera and microphone.

### Method 1: Local Port Forwarding via ADB (Recommended for Android)

1. Connect your Android phone to your PC via USB with USB Debugging enabled.
2. In Google Chrome on your PC, navigate to `chrome://inspect/#devices`.
3. Under **Port Forwarding**, forward port `3000` to `localhost:3000`.
4. Open Chrome on your Android phone and navigate to `http://localhost:3000`.
   *(Because it is accessed as `localhost`, Android treats it as a secure context, allowing rear camera and microphone access!)*

### Method 2: Testing over Local Wi-Fi (0.0.0.0)

1. Start Next.js bound to all local interfaces:
   ```bash
   npm run dev -- -H 0.0.0.0
   ```
2. Find your PC's local IP (e.g., `192.168.1.50`).
3. On your phone connected to the same Wi-Fi, open `http://192.168.1.50:3000`.
4. **Camera / Mic flag in Chrome Android**:
   If accessing via plain HTTP over IP, navigate to `chrome://flags/#unsafely-treat-insecure-origin-as-secure` on Android Chrome, add `http://192.168.1.50:3000`, and restart Chrome.

### Method 3: Cloudflare Tunnel / Ngrok (Instant HTTPS)

```bash
npx untun@latest tunnel http://localhost:3000
# or
npx localtunnel --port 3000
```
Open the generated HTTPS URL directly on your phone.

---

## HTTP API Contract

The dashboard communicates with the ESP32-CAM via standard JSON REST endpoints:

### 1. Drive Command
- **Endpoint**: `POST /api/drive`
- **Request Payload**:
  ```json
  { "command": "F" }
  ```
  *Allowed commands*: `"F"` (forward), `"B"` (backward), `"L"` (left), `"R"` (right), `"S"` (stop), `"V:180"` (set motor speed 0-255).
- **Response**:
  ```json
  { "success": true, "command": "F" }
  ```

### 2. Robotic Arm Command
- **Endpoint**: `POST /api/arm`
- **Request Payload**:
  ```json
  { "joint": "BASE", "angle": 90 }
  ```
  *Allowed joints*: `"BASE"`, `"SHOULDER"`, `"ELBOW"`, `"GRIPPER"`.
  *Angle range*: `0` to `180`.
- **Response**:
  ```json
  { "success": true, "joint": "BASE", "angle": 90 }
  ```

### 3. Telemetry & Health Status
- **Endpoint**: `GET /api/status`
- **Response**:
  ```json
  {
    "connected": true,
    "obstacleDistanceCm": 38,
    "batteryVoltage": 7.8,
    "currentSpeed": 160,
    "firmwareVersion": "NEX-ESP32-1.0",
    "rssi": -52
  }
  ```

### 4. Video Stream
- **Endpoint**: `GET /stream` (or configurable in Settings modal)
- **Response**: `multipart/x-mixed-replace; boundary=frame` MJPEG stream.

---

## Arduino & ESP32 Firmware

Complete source files are provided in the [`firmware/`](file:///firmware/) directory:
- [esp32_cam_nexrover.ino](file:///firmware/esp32_cam/esp32_cam_nexrover.ino): AI-Thinker ESP32-CAM Wi-Fi server, MJPEG streaming, and serial translation.
- [arduino_uno_nexrover.ino](file:///firmware/arduino_uno/arduino_uno_nexrover.ino): Arduino UNO L293D motor shield control, HC-SR04 sonar, and Nano relay.
- [arduino_nano_arm.ino](file:///firmware/arduino_nano/arduino_nano_arm.ino): Arduino Nano 4-DOF SG90 servo kinematic controller.

See [ESP32_FIRMWARE_GUIDE.md](file:///ESP32_FIRMWARE_GUIDE.md) for step-by-step schematics, pinout tables, level shifting, and flashing instructions.

---

## Python PC Backend (Vision & AI Proxy)

The `pc_backend/` directory provides an optional lightweight Python Flask service for offloading GPT-4o-mini vision analysis:
- **Image Inspection (`POST /api/analyze`)**: Analyzes camera captures for obstacles, drop-offs, stairs, or humans, suggesting safe commands (`F`, `B`, `L`, `R`, `S`) with mandatory operator approval.
- **Authenticated Command Proxy (`POST /api/command`)**: Securely relays validated drive and arm commands to the ESP32-CAM via `X-Rover-Token`.

```bash
cd pc_backend
python -m venv .venv
source .venv/bin/activate  # Or on Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # Configure OPENAI_API_KEY, ESP32_URL, ROVER_TOKEN
python app.py
```

---

## Safety Features

1. **Physical E-Stop**: The red E-STOP button sends an immediate halt to all motors and servos.
2. **Auto-Stop on Release**: When using hold-to-drive mode, releasing touch or mouse immediately transmits an `'S'` stop command.
3. **Collision Avoidance**: If the HC-SR04 ultrasonic sensor detects an obstacle within 10 cm, forward motion is automatically inhibited in firmware.
4. **AI Action Containment**: Natural language inputs are strictly mapped to predefined action types (`DRIVE`, `ARM`, `SPEED`, `STOP`). Raw shell commands or arbitrary code cannot be executed.

---

## License

MIT License. Designed and built for the SBU Hackathon.
