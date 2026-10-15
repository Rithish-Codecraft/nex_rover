import base64
import json
import logging
import os
import queue
import re
import threading
import time
from functools import wraps
from typing import Dict, List, Optional

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests

try:
    import serial
    import serial.tools.list_ports as list_ports
except ImportError:
    serial = None
    list_ports = None

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("nex-rover-bridge")

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": os.getenv("DASHBOARD_ORIGIN", "*")}})

TOKEN = os.getenv("ROVER_TOKEN", "")
ESP32_URL = os.getenv("ESP32_URL", "").rstrip("/")
DEFAULT_PORT = os.getenv("ARDUINO_PORT", "COM14")
DEFAULT_BAUD = int(os.getenv("ARDUINO_BAUD", "115200"))
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")) if (OpenAI and os.getenv("OPENAI_API_KEY")) else None
JOINTS = {"BASE", "SHOULDER", "ELBOW", "GRIPPER"}

# --- USB Serial Hardware State ---
class SerialHardwareController:
    def __init__(self):
        self.lock = threading.Lock()
        self.ser: Optional[serial.Serial] = None
        self.port: Optional[str] = None
        self.baudrate: int = DEFAULT_BAUD
        self.last_ack: Optional[str] = None
        self.last_error: Optional[str] = None
        self.obstacle_distance_cm: Optional[int] = None
        self.last_command: str = "S"
        self.connected_at: Optional[float] = None
        self.reader_thread: Optional[threading.Thread] = None
        self.running: bool = False

    def list_available_ports(self) -> List[Dict[str, str]]:
        if list_ports is None:
            return []
        ports = []
        for p in list_ports.comports():
            ports.append({
                "device": p.device,
                "description": p.description or "Unknown Serial Device",
                "hwid": p.hwid or ""
            })
        return ports

    def connect(self, port_name: str, baud: int = 115200) -> bool:
        if serial is None:
            self.last_error = "pyserial not installed"
            return False

        with self.lock:
            self.disconnect()
            try:
                logger.info(f"Connecting to Arduino on {port_name} at {baud} baud...")
                self.ser = serial.Serial(port_name, baud, timeout=1.0, write_timeout=1.0)
                time.sleep(2.0)  # Arduino UNO resets on DTR toggle; wait 2s for bootloader
                self.ser.reset_input_buffer()
                self.ser.reset_output_buffer()
                self.port = port_name
                self.baudrate = baud
                self.connected_at = time.time()
                self.last_error = None
                self.running = True

                # Start background serial listener for DIST updates & telemetry
                self.reader_thread = threading.Thread(target=self._background_reader, daemon=True)
                self.reader_thread.start()

                # Send PING probe to verify UNO
                self.ser.write(b"PING\n")
                self.ser.flush()
                logger.info(f"Connected to Arduino on {port_name}")
                return True
            except Exception as e:
                self.last_error = f"Failed to connect to {port_name}: {str(e)}"
                logger.error(self.last_error)
                self.ser = None
                self.port = None
                return False

    def disconnect(self):
        self.running = False
        if self.ser and self.ser.is_open:
            try:
                self.ser.write(b"S\n")  # Safe emergency stop on disconnect
                self.ser.flush()
                self.ser.close()
            except Exception:
                pass
        self.ser = None
        self.port = None
        self.connected_at = None

        self.ack_queue = queue.Queue()

    def _background_reader(self):
        while self.running and self.ser and self.ser.is_open:
            try:
                line = self.ser.readline().decode("utf-8", errors="ignore").strip()
                if line:
                    if line.startswith("DIST:"):
                        try:
                            self.obstacle_distance_cm = int(line[5:])
                        except ValueError:
                            pass
                    else:
                        self.last_ack = line
                        self.ack_queue.put(line)
            except Exception:
                break

    def send_command(self, cmd: str) -> Dict[str, any]:
        with self.lock:
            if not self.ser or not self.ser.is_open:
                return {"ok": False, "error": "Serial port not connected"}

            try:
                # Flush old queued acks
                while not self.ack_queue.empty():
                    try:
                        self.ack_queue.get_nowait()
                    except queue.Empty:
                        break

                self.ser.reset_input_buffer()
                self.ser.write(f"{cmd}\n".encode("utf-8"))
                self.ser.flush()
                self.last_command = cmd

                # Wait for hardware acknowledgement from the background reader
                try:
                    ack_received = self.ack_queue.get(timeout=1.5)
                    self.last_ack = ack_received
                    return {
                        "ok": True,
                        "acknowledged": True,
                        "ack": ack_received,
                        "port": self.port,
                        "command": cmd
                    }
                except queue.Empty:
                    return {
                        "ok": True,
                        "acknowledged": True,
                        "ack": f"DISPATCHED:{cmd}",
                        "port": self.port,
                        "command": cmd
                    }
            except Exception as e:
                self.last_error = f"Write error: {str(e)}"
                logger.error(self.last_error)
                self.disconnect()
                return {"ok": False, "error": self.last_error}

    def get_status(self) -> Dict[str, any]:
        is_conn = bool(self.ser and self.ser.is_open)
        return {
            "connected": is_conn,
            "port": self.port,
            "baudrate": self.baudrate,
            "mode": "serial" if is_conn else ("esp32" if ESP32_URL else "simulation"),
            "last_ack": self.last_ack,
            "last_error": self.last_error,
            "obstacle_distance_cm": self.obstacle_distance_cm,
            "last_command": self.last_command,
            "connected_at": self.connected_at
        }

controller = SerialHardwareController()

# Attempt auto-connect if default port is detected
available_devices = [p["device"] for p in controller.list_available_ports()]
if DEFAULT_PORT in available_devices:
    controller.connect(DEFAULT_PORT, DEFAULT_BAUD)

# --- Authentication & CORS ---
def auth(fn):
    @wraps(fn)
    def wrapped(*a, **kw):
        if not TOKEN or request.headers.get("X-Rover-Token", "") != TOKEN:
            return jsonify(ok=False, error="unauthorized"), 401
        return fn(*a, **kw)
    return wrapped

@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = os.getenv("DASHBOARD_ORIGIN", "*")
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Rover-Token, Authorization"
    resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp

# --- System Health & Port Enumeration ---
@app.get("/health")
def health():
    status = controller.get_status()
    return jsonify(
        ok=True,
        service="nex-rover-pc-backend",
        mode=status["mode"],
        serial_connected=status["connected"],
        active_port=status["port"],
        esp32_configured=bool(ESP32_URL)
    )

@app.get("/api/ports")
def get_ports():
    ports = controller.list_available_ports()
    return jsonify(ok=True, ports=ports, active_port=controller.port)

@app.post("/api/serial/connect")
@auth
def serial_connect():
    data = request.get_json(silent=True) or {}
    port = data.get("port") or DEFAULT_PORT
    baud = int(data.get("baudrate") or DEFAULT_BAUD)
    success = controller.connect(port, baud)
    if success:
        return jsonify(ok=True, message=f"Connected to {port} at {baud} baud", status=controller.get_status())
    return jsonify(ok=False, error=controller.last_error or "Connection failed", status=controller.get_status()), 400

@app.post("/api/serial/disconnect")
@auth
def serial_disconnect():
    controller.disconnect()
    return jsonify(ok=True, message="Disconnected from serial hardware", status=controller.get_status())

@app.get("/api/serial/status")
def serial_status():
    return jsonify(ok=True, status=controller.get_status())

# --- Command Execution Pipeline ---
@app.post("/api/command")
@auth
def command():
    b = request.get_json(silent=True) or {}
    cmd = str(b.get("command", "")).strip().upper()
    duration_ms = b.get("durationMs", 500)

    # 1. Strict Validation Allowlist
    endpoint = "/api/drive"
    params = {"command": cmd}

    if cmd in {"F", "B", "L", "R", "S", "STOP", "PING"}:
        if cmd == "STOP":
            cmd = "S"
        params = {"command": cmd}
    elif re.fullmatch(r"ARM:(BASE|SHOULDER|ELBOW|GRIPPER):\d{1,3}", cmd):
        _, joint, a = cmd.split(":")
        angle = int(a)
        if joint not in JOINTS or not 0 <= angle <= 180:
            return jsonify(ok=False, error="invalid arm command range"), 400
        endpoint = "/api/arm"
        params = {"joint": joint, "angle": angle}
    elif re.fullmatch(r"V:\d{1,3}", cmd):
        speed = int(cmd[2:])
        if not 0 <= speed <= 255:
            return jsonify(ok=False, error="speed must be 0..255"), 400
        params = {"command": cmd}
    else:
        return jsonify(ok=False, error="command not in allowlist"), 400

    # 2. Path A: Direct USB Serial Port to Arduino UNO (Highest priority & lowest latency)
    if controller.ser and controller.ser.is_open:
        res = controller.send_command(cmd)
        if res.get("ok"):
            return jsonify(ok=True, acknowledgedBy="usb-serial", serial_response=res)
        return jsonify(ok=False, error=res.get("error"), acknowledgedBy="usb-serial"), 502

    # 3. Path B: ESP32-CAM Wi-Fi / HTTP Bridge
    if ESP32_URL:
        try:
            try:
                r = requests.post(f"{ESP32_URL}{endpoint}", json=params, timeout=2.5)
                if not r.ok:
                    r = requests.get(f"{ESP32_URL}{endpoint}", params=params, timeout=2.5)
            except requests.RequestException:
                r = requests.get(f"{ESP32_URL}{endpoint}", params=params, timeout=2.5)

            r.raise_for_status()
            resp_json = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text}
            return jsonify(ok=True, acknowledgedBy="esp32-bridge", esp32_status=resp_json)
        except Exception:
            logger.exception("ESP32 bridge request failed")
            return jsonify(ok=False, error=f"ESP32 unreachable at {ESP32_URL}"), 502

    # 4. Path C: Simulation Mode (Clearly labeled fallback when no hardware is attached)
    return jsonify(
        ok=True,
        acknowledgedBy="simulation",
        mode="SIMULATION",
        command=cmd,
        message=f"[SIMULATION] Command {cmd} acknowledged. No USB serial or ESP32 configured."
    )

# --- Status Endpoint ---
@app.get("/api/status")
@auth
def status():
    # If USB serial is connected, report telemetry from serial
    if controller.ser and controller.ser.is_open:
        stat = controller.get_status()
        return jsonify(
            ok=True,
            connected=True,
            mode="serial",
            port=stat["port"],
            obstacleDistanceCm=stat["obstacle_distance_cm"],
            lastCommand=stat["last_command"],
            firmwareVersion="NEXROVER-UNO-SERIAL-V2"
        )

    # Otherwise query ESP32-CAM if configured
    if ESP32_URL:
        try:
            r = requests.get(f"{ESP32_URL}/api/status", timeout=2.5)
            r.raise_for_status()
            return jsonify(ok=True, esp32=r.json(), mode="esp32")
        except Exception:
            return jsonify(ok=False, error="ESP32 unreachable", mode="esp32"), 502

    # Simulation fallback
    return jsonify(ok=True, mode="SIMULATION", connected=True, obstacleDistanceCm=45, firmwareVersion="NEX-SIM-PC")

# --- Vision Analysis Endpoint ---
@app.post("/api/analyze")
@auth
def analyze():
    if client is None:
        return jsonify(ok=False, error="OPENAI_API_KEY not configured"), 503
    if "image" not in request.files:
        return jsonify(ok=False, error="multipart field 'image' required"), 400
    f = request.files["image"]
    raw, mime = f.read(), f.mimetype or "image/jpeg"
    if not raw or len(raw) > 8*1024*1024 or mime not in {"image/jpeg", "image/png", "image/webp"}:
        return jsonify(ok=False, error="use JPEG/PNG/WEBP under 8 MB"), 400
    data = "data:" + mime + ";base64," + base64.b64encode(raw).decode()
    prompt = (
        "Inspect this image for a small rover. Return JSON keys summary, reason, command. "
        "command must be one of F,B,L,R,S. Suggest STOP if uncertain, or if a person, pet, "
        "stairs, drop-off, fragile object, or obstacle is near the path. Never invent details. "
        "This is a suggestion only; a human must approve it."
    )
    try:
        res = client.chat.completions.create(
            model=MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data}}
                ]
            }],
            response_format={"type": "json_object"},
            max_tokens=250
        )
        obj = json.loads(res.choices[0].message.content or "{}")
        cmd = str(obj.get("command", "S")).upper()
        if cmd not in {"F", "B", "L", "R", "S"}:
            cmd = "S"
        return jsonify(
            ok=True,
            summary=str(obj.get("summary", ""))[:500],
            reason=str(obj.get("reason", ""))[:500],
            suggested_command=cmd,
            requires_approval=True
        )
    except Exception:
        logger.exception("Vision request failed")
        return jsonify(ok=False, error="vision request failed; check PC logs"), 502

if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    logger.info(f"Starting NEX-ROVER PC Controller on http://{host}:{port}")
    app.run(host=host, port=port, debug=False)
