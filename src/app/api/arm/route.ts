import { NextRequest, NextResponse } from 'next/server';

const VALID_JOINTS = new Set(['BASE', 'SHOULDER', 'ELBOW', 'GRIPPER']);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { joint, angle } = body;

    if (!joint || typeof joint !== 'string' || !VALID_JOINTS.has(joint.toUpperCase())) {
      return NextResponse.json(
        { error: `Invalid joint: ${joint}. Must be BASE, SHOULDER, ELBOW, or GRIPPER` },
        { status: 400 }
      );
    }

    if (typeof angle !== 'number' || isNaN(angle) || angle < 0 || angle > 180) {
      return NextResponse.json(
        { error: `Invalid angle: ${angle}. Must be an integer between 0 and 180` },
        { status: 400 }
      );
    }

    const normalizedJoint = joint.toUpperCase();
    const clampedAngle = Math.round(angle);
    const robotEndpoint = req.headers.get('x-robot-endpoint') || process.env.ROBOT_ENDPOINT;

    if (robotEndpoint) {
      try {
        const targetUrl = `${robotEndpoint.replace(/\/+$/, '')}/api/arm`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const espRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ joint: normalizedJoint, angle: clampedAngle }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (espRes.ok) {
          const espJson = await espRes.json().catch(() => ({}));
          return NextResponse.json({ success: true, forwarded: true, ...espJson });
        }
      } catch {
        // Hardware unreachable
      }
    }

    return NextResponse.json({
      success: true,
      forwarded: false,
      simulated: true,
      joint: normalizedJoint,
      angle: clampedAngle,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
