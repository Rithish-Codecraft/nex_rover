/**
 * NEX-ROVER: ESP32-CAM Firmware & Serial Bridge
 * Board: AI-Thinker ESP32-CAM
 *
 * Responsibilities:
 * 1. Hosts SoftAP "NEX-ROVER-WIFI" or connects to existing Wi-Fi.
 * 2. Streams MJPEG video from OV2640 sensor on /stream or port 81.
 * 3. Provides REST endpoints with CORS headers:
 *    - POST /api/drive  -> Parses {"command": "F"} -> Sends command to Arduino UNO over Serial
 *    - POST /api/arm    -> Parses {"joint": "BASE", "angle": 90} -> Sends ARM:BASE:90 to Arduino UNO
 *    - GET  /api/status -> Returns latest telemetry (obstacle distance, battery, RSSI) in JSON
 * 4. Bridges incoming Serial messages from UNO (e.g. "DIST:42", "BATT:7.8") to telemetry state.
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h> // ArduinoJson v6 or v7

// --- Configuration ---
// Uncomment to run in SoftAP mode (Default Hotspot)
#define SOFT_AP_MODE 1

const char* AP_SSID = "NEX-ROVER-WIFI";
const char* AP_PASS = "rover1234"; // Minimum 8 chars

// Or Station Mode (connect to local router)
const char* STA_SSID = "YOUR_WIFI_SSID";
const char* STA_PASS = "YOUR_WIFI_PASSWORD";

// AI-THINKER ESP32-CAM Pin definitions
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

WebServer server(80);

// Telemetry state cached from Arduino UNO
int obstacleDistance = -1;
float batteryVoltage = -1.0;
String lastCommand = "S";
int currentSpeed = 160;

// Set CORS headers for browser requests
void setCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, x-robot-endpoint");
}

void handleOptions() {
  setCorsHeaders();
  server.send(204);
}

// Handler: /api/drive (Supports both POST JSON and GET params)
void handleDrive() {
  setCorsHeaders();
  String cmd = "";

  if (server.hasArg("command")) {
    cmd = server.arg("command");
  } else if (server.hasArg("plain")) {
    String body = server.arg("plain");
    StaticJsonDocument<200> doc;
    DeserializationError err = deserializeJson(doc, body);
    if (!err && doc.containsKey("command")) {
      cmd = String((const char*)doc["command"]);
    }
  }

  if (cmd.length() == 0) {
    server.send(400, "application/json", "{\"error\":\"Missing command\"}");
    return;
  }

  // Forward to Arduino UNO via Serial (GPIO 1 TX)
  Serial.println(cmd);
  lastCommand = cmd;

  if (cmd.startsWith("V:")) {
    currentSpeed = cmd.substring(2).toInt();
  }

  StaticJsonDocument<200> resp;
  resp["success"] = true;
  resp["command"] = cmd;
  String output;
  serializeJson(resp, output);
  server.send(200, "application/json", output);
}

// Handler: /api/arm (Supports both POST JSON and GET params)
void handleArm() {
  setCorsHeaders();
  String joint = "";
  int angle = -1;

  if (server.hasArg("joint") && server.hasArg("angle")) {
    joint = server.arg("joint");
    angle = server.arg("angle").toInt();
  } else if (server.hasArg("plain")) {
    String body = server.arg("plain");
    StaticJsonDocument<200> doc;
    DeserializationError err = deserializeJson(doc, body);
    if (!err) {
      if (doc.containsKey("joint")) joint = String((const char*)doc["joint"]);
      if (doc.containsKey("angle")) angle = doc["angle"];
    }
  }

  joint.toUpperCase();
  if (joint.length() == 0 || angle < 0 || angle > 180) {
    server.send(400, "application/json", "{\"error\":\"Invalid joint or angle (0-180)\"}");
    return;
  }

  // Format: ARM:JOINT:ANGLE
  String armCmd = "ARM:" + joint + ":" + String(angle);
  Serial.println(armCmd);
  lastCommand = armCmd;

  StaticJsonDocument<200> resp;
  resp["success"] = true;
  resp["command"] = armCmd;
  String output;
  serializeJson(resp, output);
  server.send(200, "application/json", output);
}

// Handler: GET /api/status
void handleStatus() {
  setCorsHeaders();

  StaticJsonDocument<300> doc;
  doc["connected"] = true;
  doc["currentSpeed"] = currentSpeed;
  doc["lastCommand"] = lastCommand;
  doc["firmwareVersion"] = "NEX-ESP32-1.0";
  doc["rssi"] = WiFi.RSSI();

  if (obstacleDistance >= 0) {
    doc["obstacleDistanceCm"] = obstacleDistance;
  } else {
    doc["obstacleDistanceCm"] = nullptr;
  }

  if (batteryVoltage > 0) {
    doc["batteryVoltage"] = batteryVoltage;
  } else {
    doc["batteryVoltage"] = nullptr;
  }

  String output;
  serializeJson(doc, output);
  server.send(200, "application/json", output);
}

// Handler: GET /stream (MJPEG Camera stream)
void handleStream() {
  WiFiClient client = server.client();
  String response = "HTTP/1.1 200 OK\r\n";
  response += "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n";
  response += "Access-Control-Allow-Origin: *\r\n\r\n";
  client.print(response);

  while (client.connected()) {
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) {
      delay(50);
      continue;
    }

    client.print("--frame\r\n");
    client.print("Content-Type: image/jpeg\r\n");
    client.print("Content-Length: " + String(fb->len) + "\r\n\r\n");
    client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);

    delay(20); // ~30 fps cap
  }
}

void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_VGA; // 640x480 for smooth streaming
  config.jpeg_quality = 12;
  config.fb_count = 2;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
  }
}

void setup() {
  // Serial communication with Arduino UNO at 115200 baud
  Serial.begin(115200);

  initCamera();

#if SOFT_AP_MODE
  WiFi.softAP(AP_SSID, AP_PASS);
  IPAddress IP = WiFi.softAPIP();
  Serial.print("SoftAP IP address: ");
  Serial.println(IP); // Usually 192.168.4.1
#else
  WiFi.begin(STA_SSID, STA_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.print("Connected! IP: ");
  Serial.println(WiFi.localIP());
#endif

  // Register Routes (Supports both POST JSON and GET query parameters)
  server.on("/api/drive", HTTP_OPTIONS, handleOptions);
  server.on("/api/drive", HTTP_POST, handleDrive);
  server.on("/api/drive", HTTP_GET, handleDrive);
  server.on("/api/arm", HTTP_OPTIONS, handleOptions);
  server.on("/api/arm", HTTP_POST, handleArm);
  server.on("/api/arm", HTTP_GET, handleArm);
  server.on("/api/status", HTTP_OPTIONS, handleOptions);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/stream", HTTP_GET, handleStream);

  server.begin();
}

void loop() {
  server.handleClient();

  // Read telemetry lines coming back from Arduino UNO
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();

    if (line.startsWith("DIST:")) {
      obstacleDistance = line.substring(5).toInt();
    } else if (line.startsWith("BATT:")) {
      batteryVoltage = line.substring(5).toFloat();
    }
  }
}
