import {
  ArmJoint,
  ArmAngles,
  DriveCommand,
  RobotSettings,
  TelemetryData,
  DEFAULT_ARM_ANGLES,
} from '@/types/robot';

// Client-side simulation state singleton for seamless demo without physical ESP32
class SimulationEngine {
  private currentSpeed = 160;
  private arm: ArmAngles = { ...DEFAULT_ARM_ANGLES };
  private lastCommand: string = 'S';
  private obstacleDistanceCm = 45; // simulated cm
  private batteryVoltage = 7.8; // 2S Li-ion battery (7.4V - 8.4V)
  private isMoving = false;
  private moveDirection: DriveCommand = 'S';
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    // Simulate slight sensor fluctuations in demo mode
    if (typeof window !== 'undefined') {
      this.timer = setInterval(() => {
        if (this.isMoving) {
          if (this.moveDirection === 'F') {
            this.obstacleDistanceCm = Math.max(8, this.obstacleDistanceCm - Math.floor(Math.random() * 5 + 3));
          } else if (this.moveDirection === 'B') {
            this.obstacleDistanceCm = Math.min(180, this.obstacleDistanceCm + Math.floor(Math.random() * 6 + 4));
          }
          // Slight battery drain during movement
          this.batteryVoltage = Math.max(6.8, +(this.batteryVoltage - 0.001).toFixed(2));
        } else {
          // slight jitter
          const jitter = (Math.random() - 0.5) * 1.5;
          this.obstacleDistanceCm = Math.max(5, Math.min(200, Math.round(this.obstacleDistanceCm + jitter)));
        }
      }, 500);
    }
  }

  drive(command: DriveCommand, speed?: number): { success: boolean; message: string } {
    this.lastCommand = command;
    if (command === 'S') {
      this.isMoving = false;
      this.moveDirection = 'S';
    } else {
      this.isMoving = true;
      this.moveDirection = command;
    }
    if (speed !== undefined) {
      this.currentSpeed = Math.max(0, Math.min(255, speed));
    }
    return { success: true, message: `Simulated drive: ${command}` };
  }

  setSpeed(speed: number): { success: boolean; message: string } {
    this.currentSpeed = Math.max(0, Math.min(255, speed));
    this.lastCommand = `V:${this.currentSpeed}`;
    return { success: true, message: `Simulated speed set: ${this.currentSpeed}` };
  }

  moveArm(joint: ArmJoint, angle: number): { success: boolean; message: string } {
    const clampedAngle = Math.max(0, Math.min(180, Math.round(angle)));
    this.arm[joint] = clampedAngle;
    this.lastCommand = `ARM:${joint}:${clampedAngle}`;
    return { success: true, message: `Simulated arm ${joint} to ${clampedAngle}°` };
  }

  getTelemetry(): TelemetryData {
    return {
      connected: true,
      latencyMs: Math.floor(Math.random() * 8 + 4), // 4-12ms simulated
      batteryVoltage: +this.batteryVoltage.toFixed(2),
      obstacleDistanceCm: this.obstacleDistanceCm,
      currentSpeed: this.currentSpeed,
      arm: { ...this.arm },
      lastCommand: this.lastCommand,
      lastSeen: Date.now(),
      isSimulated: true,
      firmwareVersion: 'NEX-SIM-v1.0',
      wifiRssi: -48,
    };
  }

  resetObstacle(dist = 50) {
    this.obstacleDistanceCm = dist;
  }
}

export const simulationEngine = new SimulationEngine();

export class RobotApiClient {
  private settings: RobotSettings;
  private abortController: AbortController | null = null;

  constructor(settings: RobotSettings) {
    this.settings = settings;
  }

  updateSettings(settings: RobotSettings) {
    this.settings = settings;
  }

  async sendDriveCommand(command: DriveCommand): Promise<{ success: boolean; error?: string }> {
    if (this.settings.isSimulated) {
      simulationEngine.drive(command);
      return { success: true };
    }

    try {
      const endpoint = `${this.settings.robotIp.replace(/\/+$/, '')}/api/drive`;
      const res = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      }, this.settings.commandTimeoutMs);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Drive command failed';
      // Fallback via Next.js server proxy if direct fetch is blocked by CORS
      try {
        const proxyRes = await fetch('/api/drive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-robot-endpoint': this.settings.robotIp,
          },
          body: JSON.stringify({ command }),
        });
        if (proxyRes.ok) return { success: true };
      } catch {
        // proxy also failed
      }
      return { success: false, error: message };
    }
  }

  async sendSpeedCommand(speed: number): Promise<{ success: boolean; error?: string }> {
    const clamped = Math.max(0, Math.min(255, Math.round(speed)));
    const command = `V:${clamped}`;

    if (this.settings.isSimulated) {
      simulationEngine.setSpeed(clamped);
      return { success: true };
    }

    try {
      const endpoint = `${this.settings.robotIp.replace(/\/+$/, '')}/api/drive`;
      const res = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      }, this.settings.commandTimeoutMs);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { success: true };
    } catch {
      try {
        const proxyRes = await fetch('/api/drive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-robot-endpoint': this.settings.robotIp,
          },
          body: JSON.stringify({ command }),
        });
        if (proxyRes.ok) return { success: true };
      } catch {}
      return { success: false, error: 'Failed to send speed' };
    }
  }

  async sendArmCommand(joint: ArmJoint, angle: number): Promise<{ success: boolean; error?: string }> {
    const clampedAngle = Math.max(0, Math.min(180, Math.round(angle)));

    if (this.settings.isSimulated) {
      simulationEngine.moveArm(joint, clampedAngle);
      return { success: true };
    }

    try {
      const endpoint = `${this.settings.robotIp.replace(/\/+$/, '')}/api/arm`;
      const res = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joint, angle: clampedAngle }),
      }, this.settings.commandTimeoutMs);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { success: true };
    } catch {
      try {
        const proxyRes = await fetch('/api/arm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-robot-endpoint': this.settings.robotIp,
          },
          body: JSON.stringify({ joint, angle: clampedAngle }),
        });
        if (proxyRes.ok) return { success: true };
      } catch {}
      return { success: false, error: 'Arm command failed' };
    }
  }

  async emergencyStop(): Promise<{ success: boolean }> {
    // Send immediate Stop command
    if (this.settings.isSimulated) {
      simulationEngine.drive('S');
      return { success: true };
    }

    try {
      const endpoint = `${this.settings.robotIp.replace(/\/+$/, '')}/api/drive`;
      await Promise.race([
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'S' }),
        }),
        fetch('/api/drive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-robot-endpoint': this.settings.robotIp,
          },
          body: JSON.stringify({ command: 'S' }),
        }),
      ]);
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async fetchTelemetry(): Promise<TelemetryData> {
    if (this.settings.isSimulated) {
      return simulationEngine.getTelemetry();
    }

    const startTime = performance.now();
    const endpoint = `${this.settings.robotIp.replace(/\/+$/, '')}/api/status`;

    try {
      const res = await this.fetchWithTimeout(endpoint, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }, this.settings.commandTimeoutMs);

      if (!res.ok) throw new Error(`Status HTTP ${res.status}`);
      const data = await res.json();
      const latency = Math.round(performance.now() - startTime);

      return {
        connected: true,
        latencyMs: latency,
        batteryVoltage: typeof data.batteryVoltage === 'number' ? data.batteryVoltage : null,
        obstacleDistanceCm: typeof data.obstacleDistanceCm === 'number' ? data.obstacleDistanceCm : null,
        currentSpeed: typeof data.currentSpeed === 'number' ? data.currentSpeed : 160,
        arm: data.arm || DEFAULT_ARM_ANGLES,
        lastCommand: data.lastCommand || null,
        lastSeen: Date.now(),
        isSimulated: false,
        firmwareVersion: data.firmwareVersion || 'ESP32-CAM-UNO',
        wifiRssi: typeof data.rssi === 'number' ? data.rssi : null,
      };
    } catch {
      // Try via Next.js proxy
      try {
        const proxyRes = await fetch('/api/status', {
          headers: { 'x-robot-endpoint': this.settings.robotIp },
        });
        if (proxyRes.ok) {
          const data = await proxyRes.json();
          const latency = Math.round(performance.now() - startTime);
          return {
            connected: data.connected ?? true,
            latencyMs: latency,
            batteryVoltage: typeof data.batteryVoltage === 'number' ? data.batteryVoltage : null,
            obstacleDistanceCm: typeof data.obstacleDistanceCm === 'number' ? data.obstacleDistanceCm : null,
            currentSpeed: data.currentSpeed ?? 160,
            arm: data.arm || DEFAULT_ARM_ANGLES,
            lastCommand: data.lastCommand || null,
            lastSeen: Date.now(),
            isSimulated: false,
          };
        }
      } catch {
        // Disconnected
      }

      return {
        connected: false,
        latencyMs: null,
        batteryVoltage: null,
        obstacleDistanceCm: null,
        currentSpeed: 0,
        arm: DEFAULT_ARM_ANGLES,
        lastCommand: null,
        lastSeen: null,
        isSimulated: false,
      };
    }
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 2500): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }
}
