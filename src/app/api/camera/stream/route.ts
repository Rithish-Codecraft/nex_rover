import { NextRequest, NextResponse } from 'next/server';
import { PhoneCameraSnapshot } from '@/types/robot';

// In-memory cache for the latest phone camera frame snapshot
// Allows the laptop dashboard to preview the mobile camera feed mounted on the rover
interface StoredSnapshot extends PhoneCameraSnapshot {
  receivedAt: number;
}

let latestSnapshot: StoredSnapshot | null = null;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.dataUrl) {
      return NextResponse.json({ ok: false, error: 'Missing dataUrl' }, { status: 400 });
    }

    const { dataUrl, width = 1280, height = 720, facingMode = 'environment' } = body;

    // Validate dataUrl format
    if (!dataUrl.startsWith('data:image/')) {
      return NextResponse.json({ ok: false, error: 'Invalid dataUrl format' }, { status: 400 });
    }

    latestSnapshot = {
      dataUrl,
      width,
      height,
      facingMode,
      timestamp: Date.now(),
      receivedAt: Date.now(),
    };

    return NextResponse.json({ ok: true, timestamp: latestSnapshot.timestamp });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  if (!latestSnapshot) {
    return NextResponse.json({
      ok: true,
      hasFrame: false,
      message: 'No active phone camera stream detected. Open /camera on your mobile device.',
    });
  }

  const ageMs = Date.now() - latestSnapshot.receivedAt;
  const isStale = ageMs > 10000; // Consider stream inactive if no frame in 10s

  return NextResponse.json({
    ok: true,
    hasFrame: !isStale,
    isStale,
    ageMs,
    snapshot: latestSnapshot,
  });
}
