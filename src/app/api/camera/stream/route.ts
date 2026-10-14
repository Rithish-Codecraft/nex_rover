import { NextRequest, NextResponse } from 'next/server';
import { PhoneCameraSnapshot } from '@/types/robot';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Deployment-Compatible Shared Store for Mobile Camera Snapshots
// Resolves the Vercel serverless isolation issue where in-memory state is wiped across lambdas.
//
// Supported Transports (in order of priority):
// 1. Upstash Redis / Vercel KV REST API (when KV_REST_API_URL & KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL are set)
// 2. Shared filesystem storage in OS temp directory (works across processes on persistent hosts / containers)
// 3. Process memory fallback (globalThis)

interface StoredSnapshot extends PhoneCameraSnapshot {
  receivedAt: number;
}

// Global in-memory fallback for local dev
declare global {
  var __nexrover_latest_snapshot: StoredSnapshot | null | undefined;
  var __nexrover_laptop_ping: number | undefined;
}

const TMP_FILE_PATH = path.join(os.tmpdir(), 'nexrover_latest_snapshot.json');
const TMP_PING_PATH = path.join(os.tmpdir(), 'nexrover_laptop_ping.txt');

const getUpstashConfig = () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return { url: url.replace(/\/$/, ''), token };
  }
  return null;
};

// Upstash Redis REST Helper
async function redisCommand(command: (string | number)[]): Promise<unknown> {
  const config = getUpstashConfig();
  if (!config) return null;

  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result;
  } catch {
    return null;
  }
}

// Write snapshot to shared store
async function saveSnapshot(snapshot: StoredSnapshot): Promise<string> {
  const config = getUpstashConfig();
  if (config) {
    const result = await redisCommand(['SET', 'nexrover:snapshot', JSON.stringify(snapshot), 'EX', 30]);
    if (result) return 'upstash-redis';
  }

  // Filesystem fallback
  try {
    fs.writeFileSync(TMP_FILE_PATH, JSON.stringify(snapshot), 'utf-8');
    globalThis.__nexrover_latest_snapshot = snapshot;
    return 'fs-tmp';
  } catch {
    globalThis.__nexrover_latest_snapshot = snapshot;
    return 'memory-fallback';
  }
}

// Read snapshot from shared store
async function readSnapshot(): Promise<{ snapshot: StoredSnapshot | null; backend: string }> {
  const config = getUpstashConfig();
  if (config) {
    const res = await redisCommand(['GET', 'nexrover:snapshot']);
    if (res) {
      try {
        const parsed = typeof res === 'string' ? JSON.parse(res) : res;
        return { snapshot: parsed, backend: 'upstash-redis' };
      } catch {
        // Fall through
      }
    }
  }

  // Filesystem fallback
  try {
    if (fs.existsSync(TMP_FILE_PATH)) {
      const data = fs.readFileSync(TMP_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      return { snapshot: parsed, backend: 'fs-tmp' };
    }
  } catch {
    // Fall through
  }

  return { snapshot: globalThis.__nexrover_latest_snapshot || null, backend: 'memory-fallback' };
}

// Record and check laptop active polling
async function recordLaptopRead(): Promise<void> {
  const now = Date.now();
  const config = getUpstashConfig();
  if (config) {
    await redisCommand(['SET', 'nexrover:laptop_ping', String(now), 'EX', 30]);
  }
  try {
    fs.writeFileSync(TMP_PING_PATH, String(now), 'utf-8');
  } catch {
    // Ignore
  }
  globalThis.__nexrover_laptop_ping = now;
}

async function getLastLaptopPing(): Promise<number> {
  const config = getUpstashConfig();
  if (config) {
    const res = await redisCommand(['GET', 'nexrover:laptop_ping']);
    if (res) return Number(res) || 0;
  }
  try {
    if (fs.existsSync(TMP_PING_PATH)) {
      return Number(fs.readFileSync(TMP_PING_PATH, 'utf-8')) || 0;
    }
  } catch {
    // Fall through
  }
  return globalThis.__nexrover_laptop_ping || 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.dataUrl) {
      return NextResponse.json({ ok: false, error: 'Missing dataUrl payload' }, { status: 400 });
    }

    const { dataUrl, width = 1280, height = 720, facingMode = 'environment' } = body;

    if (!dataUrl.startsWith('data:image/')) {
      return NextResponse.json({ ok: false, error: 'Invalid dataUrl: Must be a base64 data:image URL' }, { status: 400 });
    }

    const snapshot: StoredSnapshot = {
      dataUrl,
      width: Number(width) || 1280,
      height: Number(height) || 720,
      facingMode,
      timestamp: Date.now(),
      receivedAt: Date.now(),
    };

    const storageBackend = await saveSnapshot(snapshot);
    const lastLaptopPing = await getLastLaptopPing();
    const laptopActive = lastLaptopPing > 0 && Date.now() - lastLaptopPing < 6000;

    return NextResponse.json({
      ok: true,
      timestamp: snapshot.timestamp,
      laptopActive,
      lastLaptopPing,
      storageBackend,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  await recordLaptopRead();
  const { snapshot, backend } = await readSnapshot();

  if (!snapshot) {
    return NextResponse.json({
      ok: true,
      hasFrame: false,
      message: 'No active phone camera stream detected. Open /camera on your mobile device.',
      storageBackend: backend,
    });
  }

  const ageMs = Date.now() - snapshot.receivedAt;
  const isStale = ageMs > 10000; // Inactive if older than 10s

  return NextResponse.json({
    ok: true,
    hasFrame: !isStale,
    isStale,
    ageMs,
    storageBackend: backend,
    snapshot,
  });
}
