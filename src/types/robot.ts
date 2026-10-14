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
