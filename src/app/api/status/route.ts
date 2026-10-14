import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const robotEndpoint = req.headers.get('x-robot-endpoint') || process.env.ROBOT_ENDPOINT;

  if (robotEndpoint) {
    try {
      const targetUrl = `${robotEndpoint.replace(/\/+$/, '')}/api/status`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(targetUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ ...data, connected: true });
      }
    } catch {
      // Hardware unreachable
    }
  }

  // Fallback status indicating disconnected from hardware or waiting
  return NextResponse.json({
    connected: false,
    hardwareActive: false,
    batteryVoltage: null,
    obstacleDistanceCm: null,
    message: 'ESP32-CAM not reachable. Use simulation mode or configure robot IP.',
    timestamp: Date.now(),
  });
}
