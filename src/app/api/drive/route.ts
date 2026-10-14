import { NextRequest, NextResponse } from 'next/server';

const VALID_COMMANDS = new Set(['F', 'B', 'L', 'R', 'S']);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const command = body.command;

    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid command string' }, { status: 400 });
    }

    // Validate command format
    const isBasicDrive = VALID_COMMANDS.has(command);
    const isSpeedCmd = /^V:\d{1,3}$/.test(command);

    if (!isBasicDrive && !isSpeedCmd) {
      return NextResponse.json(
        { error: `Invalid command: ${command}. Allowed: F, B, L, R, S or V:<0-255>` },
        { status: 400 }
      );
    }

    if (isSpeedCmd) {
      const speed = parseInt(command.substring(2), 10);
      if (speed < 0 || speed > 255) {
        return NextResponse.json({ error: 'Speed must be between 0 and 255' }, { status: 400 });
      }
    }

    const robotEndpoint = req.headers.get('x-robot-endpoint') || process.env.ROBOT_ENDPOINT;

    if (robotEndpoint) {
      try {
        const targetUrl = `${robotEndpoint.replace(/\/+$/, '')}/api/drive`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const espRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (espRes.ok) {
          const espJson = await espRes.json().catch(() => ({}));
          return NextResponse.json({ success: true, forwarded: true, ...espJson });
        }
      } catch {
        // Hardware unreachable; respond gracefully
      }
    }

    // Default simulation/local acknowledgement
    return NextResponse.json({
      success: true,
      forwarded: false,
      simulated: true,
      command,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
