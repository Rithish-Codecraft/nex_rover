import base64, json, os, re
from functools import wraps
import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from openai import OpenAI

load_dotenv()
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": os.getenv("DASHBOARD_ORIGIN", "*")}})
TOKEN = os.getenv("ROVER_TOKEN", "")
ESP32_URL = os.getenv("ESP32_URL", "").rstrip("/")
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")) if os.getenv("OPENAI_API_KEY") else None
JOINTS = {"BASE", "SHOULDER", "ELBOW", "GRIPPER"}

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

@app.get("/health")
def health():
    return jsonify(ok=True, service="nex-rover-pc-backend", esp32_configured=bool(ESP32_URL))

@app.post("/api/analyze")
@auth
def analyze():
    if client is None:
        return jsonify(ok=False, error="OPENAI_API_KEY not configured"), 503
    if "image" not in request.files:
        return jsonify(ok=False, error="multipart field 'image' required"), 400
    f = request.files["image"]
    raw, mime = f.read(), f.mimetype or "image/jpeg"
    if not raw or len(raw) > 8*1024*1024 or mime not in {"image/jpeg","image/png","image/webp"}:
        return jsonify(ok=False, error="use JPEG/PNG/WEBP under 8 MB"), 400
    data = "data:"+mime+";base64,"+base64.b64encode(raw).decode()
    prompt = ("Inspect this image for a small rover. Return JSON keys summary, reason, command. "
              "command must be one of F,B,L,R,S. Suggest STOP if uncertain, or if a person, pet, "
              "stairs, drop-off, fragile object, or obstacle is near the path. Never invent details. "
              "This is a suggestion only; a human must approve it.")
    try:
        res = client.chat.completions.create(
            model=MODEL,
            messages=[{"role":"user","content":[{"type":"text","text":prompt},
                      {"type":"image_url","image_url":{"url":data}}]}],
            response_format={"type":"json_object"}, max_tokens=250)
        obj = json.loads(res.choices[0].message.content or "{}")
        cmd = str(obj.get("command","S")).upper()
        if cmd not in {"F","B","L","R","S"}: cmd="S"
        return jsonify(ok=True, summary=str(obj.get("summary",""))[:500],
                       reason=str(obj.get("reason",""))[:500],
                       suggested_command=cmd, requires_approval=True)
    except Exception:
        app.logger.exception("Vision request failed")
        return jsonify(ok=False,error="vision request failed; check PC logs"),502

@app.post("/api/command")
@auth
def command():
    if not ESP32_URL: return jsonify(ok=False,error="ESP32_URL not configured"),503
    b=request.get_json(silent=True) or {}
    cmd=str(b.get("command","")).strip().upper()
    if cmd in {"F","B","L","R","S","STOP","PING"}:
        endpoint="/api/drive"; params={"command":cmd}
    elif re.fullmatch(r"ARM:(BASE|SHOULDER|ELBOW|GRIPPER):\d{1,3}",cmd):
        _,joint,a=cmd.split(":")
        if joint not in JOINTS or not 0<=int(a)<=180:
            return jsonify(ok=False,error="invalid arm command"),400
        endpoint="/api/arm"; params={"joint":joint,"angle":int(a)}
    elif re.fullmatch(r"V:\d{1,3}",cmd):
        speed=int(cmd[2:])
        if not 0<=speed<=255: return jsonify(ok=False,error="speed 0..255"),400
        endpoint="/api/drive"; params={"command":cmd}
    else:
        return jsonify(ok=False,error="command not allowed"),400
    try:
        # Try POST with JSON first (standard contract), fallback to GET with query params
        try:
            r = requests.post(ESP32_URL + endpoint, json=params, timeout=2.5)
            if not r.ok:
                r = requests.get(ESP32_URL + endpoint, params=params, timeout=2.5)
        except requests.RequestException:
            r = requests.get(ESP32_URL + endpoint, params=params, timeout=2.5)
        
        r.raise_for_status()
        resp_json = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text}
        return jsonify(ok=True, esp32_status=resp_json)
    except Exception:
        app.logger.exception("ESP32 request failed")
        return jsonify(ok=False, error=f"ESP32 unreachable at {ESP32_URL}; check hotspot and IP"), 502

@app.get("/api/status")
@auth
def status():
    try:
        r=requests.get(ESP32_URL+"/api/status",timeout=2.5); r.raise_for_status()
        return jsonify(ok=True,esp32=r.json())
    except Exception:
        return jsonify(ok=False,error="ESP32 unreachable"),502

if __name__=="__main__":
    app.run(host=os.getenv("HOST","127.0.0.1"),port=int(os.getenv("PORT","5000")),debug=False)
