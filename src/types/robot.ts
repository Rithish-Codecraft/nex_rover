export type DriveCommand = 'F' | 'B' | 'L' | 'R' | 'S';

export type ArmJoint = 'BASE' | 'SHOULDER' | 'ELBOW' | 'GRIPPER';

export interface ArmAngles {
  BASE: number;       // 0 to 180 degrees (default 90)
  SHOULDER: number;   // 0 to 180 degrees (default 90)
  ELBOW: number;      // 0 to 180 degrees (default 90)
  GRIPPER: number;    // 0 to 180 degrees (default 60 - open/close)
}

export interface TelemetryData {
  connected: boolean;
  latencyMs: number | null;
  batteryVoltage: number | null;        // null if no physical telemetry / unsupported
  obstacleDistanceCm: number | null;    // null if no physical telemetry
  currentSpeed: number;                 // 0 to 255
  arm: ArmAngles;
  lastCommand: string | null;
  lastSeen: number | null;
  isSimulated: boolean;
  firmwareVersion?: string;
  wifiRssi?: number | null;
}

export interface RobotSettings {
  robotIp: string;              // e.g. "http://192.168.4.1"
  cameraStreamUrl: string;      // e.g. "http://192.168.4.1:81/stream"
  pcBackendUrl: string;         // e.g. "http://127.0.0.1:5000" or local PC LAN IP
  roverToken: string;           // token for X-Rover-Token auth
  usePcRelay: boolean;          // true = route commands via PC backend relay (recommended for HTTPS)
  isSimulated: boolean;         // true = simulation mode, false = physical hardware
  holdToDrive: boolean;         // true = stop when released, false = click to toggle
  pollIntervalMs: number;       // status polling interval (e.g. 1000ms)
  speechAudioFeedback: boolean; // voice feedback using SpeechSynthesis
  commandTimeoutMs: number;     // timeout before assuming disconnect (e.g. 2500ms)
}

export type ValidatedRobotAction =
  | { type: 'DRIVE'; command: DriveCommand; durationMs?: number }
  | { type: 'SPEED'; value: number }
  | { type: 'ARM'; joint: ArmJoint; angle: number }
  | { type: 'ARM_POSE'; name: string; angles: Partial<ArmAngles> }
  | { type: 'STOP' }
  | { type: 'ESTOP' }
  | { type: 'STATUS_QUERY' };

export interface ChatMessage {
  id: string;
  sender: 'user' | 'rover' | 'system';
  text: string;
  timestamp: string;
  action?: ValidatedRobotAction;
  status?: 'pending' | 'executed' | 'rejected' | 'simulated';
}

export interface ArmPosePreset {
  name: string;
  label: string;
  description: string;
  angles: ArmAngles;
}

export const DEFAULT_ARM_ANGLES: ArmAngles = {
  BASE: 90,
  SHOULDER: 90,
  ELBOW: 90,
  GRIPPER: 60,
};

export const ARM_PRESETS: ArmPosePreset[] = [
  {
    name: 'park',
    label: 'Park / Fold',
    description: 'Safe folded transport position',
    angles: { BASE: 90, SHOULDER: 160, ELBOW: 30, GRIPPER: 20 },
  },
  {
    name: 'reach',
    label: 'Reach Forward',
    description: 'Arm extended forward for inspection',
    angles: { BASE: 90, SHOULDER: 80, ELBOW: 110, GRIPPER: 60 },
  },
  {
    name: 'grab',
    label: 'Pick Object',
    description: 'Arm angled down with gripper open',
    angles: { BASE: 90, SHOULDER: 120, ELBOW: 140, GRIPPER: 90 },
  },
  {
    name: 'closed',
    label: 'Grip Close',
    description: 'Close gripper clamp securely',
    angles: { BASE: 90, SHOULDER: 90, ELBOW: 90, GRIPPER: 10 },
  },
  {
    name: 'wave',
    label: 'Wave Hello',
    description: 'Raised gesture greeting',
    angles: { BASE: 45, SHOULDER: 60, ELBOW: 120, GRIPPER: 80 },
  },
];

// --- Gemini AI Vision Types ---

export type GeminiVisionAction =
  | 'STOP'
  | 'FORWARD'
  | 'BACKWARD'
  | 'LEFT'
  | 'RIGHT'
  | 'ARM_ACTION'
  | 'NO_ACTION';

export interface GeminiArmAction {
  joint: ArmJoint;
  angle: number; // 0 to 180
}

export interface GeminiVisionRecommendation {
  sceneSummary: string;
  detectedObjects: string[];
  hazards: string[];
  recommendedAction: GeminiVisionAction;
  armAction?: GeminiArmAction;
  speed: number;        // integer from 0 to 255 (conservative default 120-150)
  durationMs: number;   // integer from 0 to 1000 (enforced <= 1000ms)
  confidence: number;   // number from 0 to 1
  requiresApproval: boolean; // must be true
  reason: string;
}

export interface VisionAnalysisResult {
  ok: boolean;
  recommendation?: GeminiVisionRecommendation;
  error?: string;
  source?: 'gemini-vision' | 'simulation-vision';
  modelUsed?: string;
  rawResponse?: string;
}

export interface CapturedFrame {
  dataUrl: string; // base64 data URL (e.g. data:image/jpeg;base64,...)
  width: number;
  height: number;
  timestamp: string;
}

export type ApprovalState =
  | 'idle'
  | 'analyzing'
  | 'recommendation_ready'
  | 'approving'
  | 'executed'
  | 'rejected'
  | 'failed';

export interface RelayCommandResult {
  ok: boolean;
  commandSent?: string;
  esp32Status?: Record<string, unknown>;
  error?: string;
  acknowledgedBy?: 'pc-backend' | 'esp32-direct' | 'simulation';
}
