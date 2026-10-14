import { ValidatedRobotAction, ArmJoint } from '@/types/robot';

export interface ParseResult {
  action: ValidatedRobotAction | null;
  replyText: string;
  confidence: number;
}

/**
 * Deterministic local parser for instantaneous, offline, zero-latency NLP.
 * Essential for hackathon robotics demonstrations where internet/API might lag.
 */
export function parseLocalCommand(rawInput: string): ParseResult {
  const input = rawInput.trim().toLowerCase();

  // 1. Emergency stop & stop
  if (
    input.includes('emergency') ||
    input.includes('e-stop') ||
    input.includes('estop') ||
    input.includes('abort')
  ) {
    return {
      action: { type: 'ESTOP' },
      replyText: 'EMERGENCY STOP TRIGGERED. All actuators halted immediately.',
      confidence: 1.0,
    };
  }

  if (
    input === 'stop' ||
    input === 'halt' ||
    input === 'freeze' ||
    input === 'pause' ||
    input.startsWith('stop ') ||
    input.endsWith(' stop')
  ) {
    return {
      action: { type: 'STOP' },
      replyText: 'Command confirmed: Halting all rover motors.',
      confidence: 0.98,
    };
  }

  // 2. Speed adjustments
  const speedMatch = input.match(/(?:set\s+)?speed\s+(?:to\s+)?(\d+)/i) ||
                     input.match(/velocity\s+(?:to\s+)?(\d+)/i) ||
                     input.match(/v:(\d+)/i);
  if (speedMatch) {
    const rawVal = parseInt(speedMatch[1], 10);
    const speed = Math.max(0, Math.min(255, isNaN(rawVal) ? 160 : rawVal));
    return {
      action: { type: 'SPEED', value: speed },
      replyText: `Motor speed calibrated to ${speed}/255.`,
      confidence: 0.95,
    };
  }

  if (input.includes('max speed') || input.includes('full speed') || input.includes('fast')) {
    return {
      action: { type: 'SPEED', value: 255 },
      replyText: 'Throttle set to maximum (255). Exercise caution.',
      confidence: 0.9,
    };
  }

  if (input.includes('slow speed') || input.includes('crawl') || input.includes('slow down')) {
    return {
      action: { type: 'SPEED', value: 90 },
      replyText: 'Throttle reduced to precision crawling speed (90/255).',
      confidence: 0.9,
    };
  }

  // 3. Movement with duration extraction (e.g. "move forward 3 seconds")
  const durationMatch = input.match(/(\d+)\s*(?:seconds?|secs?|s)/i);
  const durationMs = durationMatch ? parseInt(durationMatch[1], 10) * 1000 : undefined;

  if (
    input.includes('forward') ||
    input.includes('ahead') ||
    input.includes('straight') ||
    input.startsWith('go ') && !input.includes('back')
  ) {
    return {
      action: { type: 'DRIVE', command: 'F', durationMs },
      replyText: durationMs
        ? `Engaging forward drive for ${durationMs / 1000} seconds.`
        : 'Engaging forward drive.',
      confidence: 0.95,
    };
  }

  if (input.includes('backward') || input.includes('reverse') || input.includes('back up') || input === 'back') {
    return {
      action: { type: 'DRIVE', command: 'B', durationMs },
      replyText: durationMs
        ? `Reversing rover for ${durationMs / 1000} seconds.`
        : 'Reversing rover.',
      confidence: 0.95,
    };
  }

  if (input.includes('left')) {
    return {
      action: { type: 'DRIVE', command: 'L', durationMs: durationMs || 600 },
      replyText: 'Rotating rover left.',
      confidence: 0.92,
    };
  }

  if (input.includes('right')) {
    return {
      action: { type: 'DRIVE', command: 'R', durationMs: durationMs || 600 },
      replyText: 'Rotating rover right.',
      confidence: 0.92,
    };
  }

  // 4. Arm Presets
  if (input.includes('wave') || input.includes('hello') || input.includes('greet')) {
    return {
      action: { type: 'ARM_POSE', name: 'wave', angles: { BASE: 45, SHOULDER: 60, ELBOW: 120, GRIPPER: 80 } },
      replyText: 'Executing greeting wave sequence.',
      confidence: 0.9,
    };
  }

  if (input.includes('park') || input.includes('fold') || input.includes('home')) {
    return {
      action: { type: 'ARM_POSE', name: 'park', angles: { BASE: 90, SHOULDER: 160, ELBOW: 30, GRIPPER: 20 } },
      replyText: 'Folding robotic arm into transport park position.',
      confidence: 0.9,
    };
  }

  if (input.includes('grab') || input.includes('pick') || input.includes('catch')) {
    return {
      action: { type: 'ARM_POSE', name: 'grab', angles: { BASE: 90, SHOULDER: 120, ELBOW: 140, GRIPPER: 90 } },
      replyText: 'Lowering arm to grab posture with open gripper.',
      confidence: 0.9,
    };
  }

  if (input.includes('reach') || input.includes('extend')) {
    return {
      action: { type: 'ARM_POSE', name: 'reach', angles: { BASE: 90, SHOULDER: 80, ELBOW: 110, GRIPPER: 60 } },
      replyText: 'Extending arm forward for object inspection.',
      confidence: 0.9,
    };
  }

  // 5. Individual Arm Joints
  if (input.includes('open gripper') || input.includes('release') || input.includes('open claw') || input.includes('drop')) {
    return {
      action: { type: 'ARM', joint: 'GRIPPER', angle: 90 },
      replyText: 'Opening gripper clamp to 90°.',
      confidence: 0.95,
    };
  }

  if (input.includes('close gripper') || input.includes('clamp') || input.includes('close claw') || input.includes('grip')) {
    return {
      action: { type: 'ARM', joint: 'GRIPPER', angle: 10 },
      replyText: 'Closing gripper clamp securely (10°).',
      confidence: 0.95,
    };
  }

  // Joint angle parsing: e.g. "base to 120", "elbow 45 degrees", "arm:shoulder:80"
  const jointMatch = input.match(/(base|shoulder|elbow|gripper)\s+(?:to\s+|at\s+)?(\d+)/i) ||
                     input.match(/arm:(base|shoulder|elbow|gripper):(\d+)/i);
  if (jointMatch) {
    const joint = jointMatch[1].toUpperCase() as ArmJoint;
    const rawAngle = parseInt(jointMatch[2], 10);
    const angle = Math.max(0, Math.min(180, isNaN(rawAngle) ? 90 : rawAngle));
    return {
      action: { type: 'ARM', joint, angle },
      replyText: `Calibrating ${joint} servo to ${angle}°.`,
      confidence: 0.96,
    };
  }

  // Status check / Ping
  if (input.includes('status') || input.includes('battery') || input.includes('ping') || input.includes('distance')) {
    return {
      action: { type: 'STATUS_QUERY' },
      replyText: 'Requesting live telemetry and sensor metrics.',
      confidence: 0.88,
    };
  }

  // Unknown command
  return {
    action: null,
    replyText: `Command "${rawInput}" unrecognized. Supported commands: "forward", "backward", "left", "right", "stop", "speed <0-255>", "open/close gripper", "park arm", "wave".`,
    confidence: 0.2,
  };
}

/**
 * Backend Proxy AI Parser (optional LLM interpretation)
 * Sends prompt to /api/ai which holds the API key securely.
 */
export async function parseWithCloudLLM(rawInput: string): Promise<ParseResult> {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: rawInput }),
    });

    if (!res.ok) {
      throw new Error(`Cloud LLM HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      action: data.action || null,
      replyText: data.replyText || 'Command processed.',
      confidence: data.confidence || 0.85,
    };
  } catch {
    // Graceful offline fallback
    return parseLocalCommand(rawInput);
  }
}
