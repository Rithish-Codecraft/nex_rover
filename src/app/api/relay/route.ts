import { NextRequest, NextResponse } from 'next/server';
import { GeminiVisionAction, ArmJoint } from '@/types/robot';

const ALLOWED_ACTIONS: Set<GeminiVisionAction> = new Set([
  'STOP',
  'FORWARD',
  'BACKWARD',
  'LEFT',
  'RIGHT',
  'ARM_ACTION',
  'NO_ACTION',
]);

const ACTION_TO_DRIVE_CMD: Record<string, string> = {
  FORWARD: 'F',
  BACKWARD: 'B',
  LEFT: 'L',
  RIGHT: 'R',
  STOP: 'S',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ ok: false, error: 'Empty request body' }, { status: 400 });
    }

    const {
      action,
      armAction,
      speed = 130,
      durationMs = 500,
      pcBackendUrl = process.env.PC_BACKEND_URL || 'http://127.0.0.1:5000',
      roverToken = process.env.ROVER_TOKEN || '',
      robotIp = process.env.ROBOT_ENDPOINT || 'http://192.168.4.1',
      usePcRelay = true,
      isSimulated = false,
    } = body;

    // Safety: Validate action
    const normalizedAction = String(action || '').toUpperCase() as GeminiVisionAction;
    if (!ALLOWED_ACTIONS.has(normalizedAction)) {
      return NextResponse.json(
        { ok: false, error: `Invalid action: ${action}. Allowed: STOP, FORWARD, BACKWARD, LEFT, RIGHT, ARM_ACTION, NO_ACTION` },
        { status: 400 }
      );
    }

    if (normalizedAction === 'NO_ACTION') {
      return NextResponse.json({
        ok: true,
        commandSent: 'NO_ACTION',
        message: 'No movement dispatched (NO_ACTION approved)',
        acknowledgedBy: 'system',
      });
    }

    // Determine the exact serial/HTTP command to send
    let commandToSend = '';

    if (normalizedAction in ACTION_TO_DRIVE_CMD) {
      commandToSend = ACTION_TO_DRIVE_CMD[normalizedAction];
    } else if (normalizedAction === 'ARM_ACTION') {
      if (!armAction || !armAction.joint || typeof armAction.angle !== 'number') {
        return NextResponse.json(
          { ok: false, error: 'Missing or invalid armAction parameters (joint, angle required)' },
          { status: 400 }
        );
      }
      const joint = String(armAction.joint).toUpperCase() as ArmJoint;
      const angle = Math.max(0, Math.min(180, Math.round(armAction.angle)));
      commandToSend = `ARM:${joint}:${angle}`;
    }

    // Enforce speed and duration safety limits
    const safeSpeed = Math.max(0, Math.min(255, Math.round(speed)));
    // Max duration strictly bounded to 1000ms
    const safeDurationMs = Math.max(100, Math.min(1000, Math.round(durationMs)));

    // Simulation Mode check
    if (isSimulated) {
      return NextResponse.json({
        ok: true,
        commandSent: commandToSend,
        speedSent: safeSpeed,
        durationMs: safeDurationMs,
        acknowledgedBy: 'simulation',
        message: `Simulated execution of ${commandToSend} at speed ${safeSpeed} for ${safeDurationMs}ms`,
      });
    }

    // Hardware Execution Path
    // Path A: Authenticated PC Backend Relay (Recommended for HTTPS)
    if (usePcRelay && pcBackendUrl) {
      const relayTarget = `${pcBackendUrl.replace(/\/+$/, '')}/api/command`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      try {
        // If movement action, optionally calibrate speed first if not standard
        if (['F', 'B', 'L', 'R'].includes(commandToSend) && safeSpeed !== 160) {
          await fetch(relayTarget, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Rover-Token': roverToken,
            },
            body: JSON.stringify({ command: `V:${safeSpeed}` }),
            signal: controller.signal,
          }).catch(() => {});
        }

        // Send primary command to PC Backend
        const relayRes = await fetch(relayTarget, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Rover-Token': roverToken,
          },
          body: JSON.stringify({ command: commandToSend }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!relayRes.ok) {
          const errText = await relayRes.text().catch(() => '');
          return NextResponse.json(
            {
              ok: false,
              error: `PC Backend error (${relayRes.status}): ${errText}`,
              acknowledgedBy: 'pc-backend',
            },
            { status: 502 }
          );
        }

        const data = await relayRes.json();
        return NextResponse.json({
          ok: true,
          commandSent: commandToSend,
          durationMs: safeDurationMs,
          esp32Status: data.esp32_status,
          acknowledgedBy: 'pc-backend',
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Relay request failed';
        return NextResponse.json(
          {
            ok: false,
            error: `Failed to contact PC Backend at ${pcBackendUrl}: ${msg}. Ensure app.py is running.`,
            acknowledgedBy: 'pc-backend',
          },
          { status: 504 }
        );
      }
    }

    // Path B: Direct ESP32-CAM Bridge (if direct IP communication is enabled)
    try {
      const targetUrl = `${robotIp.replace(/\/+$/, '')}/api/drive`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);

      const espRes = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: commandToSend }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (espRes.ok) {
        const data = await espRes.json().catch(() => ({}));
        return NextResponse.json({
          ok: true,
          commandSent: commandToSend,
          durationMs: safeDurationMs,
          esp32Status: data,
          acknowledgedBy: 'esp32-direct',
        });
      }

      return NextResponse.json(
        { ok: false, error: `ESP32 returned HTTP ${espRes.status}`, acknowledgedBy: 'esp32-direct' },
        { status: 502 }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Direct ESP32 connection failed';
      return NextResponse.json(
        { ok: false, error: `Direct ESP32 connection failed: ${msg}`, acknowledgedBy: 'esp32-direct' },
        { status: 504 }
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
