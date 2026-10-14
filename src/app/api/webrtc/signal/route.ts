import { NextRequest, NextResponse } from 'next/server';

// Lightweight in-memory signaling store for WebRTC connection between phone (broadcaster) and laptop (viewer)
interface SignalPayload {
  role: 'phone' | 'laptop';
  type: 'offer' | 'answer' | 'ice-candidate';
  payload: unknown;
  timestamp: number;
}

let pendingSignals: SignalPayload[] = [];

// Cleanup stale signals older than 30s
function purgeStaleSignals() {
  const cutoff = Date.now() - 30000;
  pendingSignals = pendingSignals.filter((s) => s.timestamp > cutoff);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.role || !body.type || !body.payload) {
      return NextResponse.json({ ok: false, error: 'Invalid signal payload' }, { status: 400 });
    }

    purgeStaleSignals();

    const signal: SignalPayload = {
      role: body.role,
      type: body.type,
      payload: body.payload,
      timestamp: Date.now(),
    };

    pendingSignals.push(signal);
    return NextResponse.json({ ok: true, stored: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    purgeStaleSignals();
    const { searchParams } = new URL(req.url);
    const targetRole = searchParams.get('for') as 'phone' | 'laptop' | null;

    if (!targetRole) {
      return NextResponse.json({ ok: false, error: "Missing 'for' query parameter" }, { status: 400 });
    }

    // Signals intended for 'phone' come from 'laptop', and vice versa
    const senderRole = targetRole === 'phone' ? 'laptop' : 'phone';
    const forMe = pendingSignals.filter((s) => s.role === senderRole);

    // Remove the retrieved signals so they are not consumed repeatedly
    pendingSignals = pendingSignals.filter((s) => s.role !== senderRole);

    return NextResponse.json({ ok: true, signals: forMe });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
