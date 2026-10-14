import { NextRequest, NextResponse } from 'next/server';
import { GeminiVisionRecommendation, ArmJoint, GeminiVisionAction } from '@/types/robot';

const VALID_ACTIONS: Set<GeminiVisionAction> = new Set([
  'STOP',
  'FORWARD',
  'BACKWARD',
  'LEFT',
  'RIGHT',
  'ARM_ACTION',
  'NO_ACTION',
]);

const VALID_JOINTS: Set<ArmJoint> = new Set(['BASE', 'SHOULDER', 'ELBOW', 'GRIPPER']);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || !body.image) {
      return NextResponse.json(
        { ok: false, error: 'Missing image payload (multipart or base64 dataUrl required)' },
        { status: 400 }
      );
    }

    const { image, task } = body;
    const userTask = typeof task === 'string' && task.trim() ? task.trim() : 'Inspect path for obstacles and suggest safe rover navigation';

    // Extract mime type and base64 data
    let mimeType = 'image/jpeg';
    let base64Data = '';

    if (image.startsWith('data:')) {
      const match = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (!match) {
        return NextResponse.json(
          { ok: false, error: 'Invalid data URL format. Expected data:image/jpeg;base64,...' },
          { status: 400 }
        );
      }
      mimeType = match[1].toLowerCase();
      base64Data = match[2];
    } else {
      base64Data = image;
    }

    // Validate mime type
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported image format: ${mimeType}. Use JPEG, PNG, or WebP.` },
        { status: 400 }
      );
    }

    // Validate size limit (max 4MB raw)
    const approximateSizeBytes = (base64Data.length * 3) / 4;
    if (approximateSizeBytes > 4 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: 'Image exceeds maximum allowable size of 4MB' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: 'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in .env.local or your Vercel Environment Variables.',
        },
        { status: 503 }
      );
    }

    const systemInstruction = `You are the safety-critical vision navigation AI for NEX-ROVER, a 4WD mobile robot equipped with a 4-DOF robotic arm.
Analyze the provided camera frame according to the operator's task: "${userTask}".

CRITICAL SAFETY PROTOCOLS:
1. A 2D single camera image CANNOT establish reliable 3D depth or guarantee an open path.
2. If there are people, pets, stairs, steep drop-offs, cliffs, reflective glass, tight doorways, or fragile obstacles anywhere near the rover's path, you MUST recommend "STOP" or "NO_ACTION".
3. If the camera frame is blurry, too dark, overexposed, ambiguous, or pointed at an obstacle within immediate range, you MUST recommend "STOP".
4. Movement duration (durationMs) must NEVER exceed 1000 ms. All movements must be conservative incremental exploratory steps.
5. Speed must be between 90 and 160 (conservative crawl or cruise). Never exceed 180 for automated suggestions.
6. Arm actions must specify valid joint ("BASE", "SHOULDER", "ELBOW", "GRIPPER") and angle integer between 0 and 180.
7. You must NEVER output raw Arduino C/C++ code, shell scripts, URLs, or arbitrary serial commands.
8. Output MUST strictly conform to the JSON schema below.

Required JSON Structure:
{
  "sceneSummary": "Concise 1-2 sentence description of terrain, ground surface, lighting, and immediate foreground",
  "detectedObjects": ["list", "of", "detected", "items"],
  "hazards": ["list of any obstacles, drops, clutter, or potential risks; empty array if none"],
  "recommendedAction": "STOP" | "FORWARD" | "BACKWARD" | "LEFT" | "RIGHT" | "ARM_ACTION" | "NO_ACTION",
  "armAction": {
    "joint": "BASE" | "SHOULDER" | "ELBOW" | "GRIPPER",
    "angle": 90
  },
  "speed": 130,
  "durationMs": 600,
  "confidence": 0.85,
  "requiresApproval": true,
  "reason": "Detailed explanation of why this action is safe and how hazards were evaluated"
}`;

    // Call Google Gemini generateContent API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout

    let geminiRes: Response;
    try {
      geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: systemInstruction },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      return NextResponse.json(
        { ok: false, error: `Gemini API returned error ${geminiRes.status}: ${errText.substring(0, 300)}` },
        { status: 502 }
      );
    }

    const geminiData = await geminiRes.json();
    const candidateText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      return NextResponse.json(
        { ok: false, error: 'Gemini returned an empty or blocked candidate response' },
        { status: 502 }
      );
    }

    // Parse and strictly validate the JSON response
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(candidateText);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Failed to parse JSON response from Gemini Vision' },
        { status: 502 }
      );
    }

    // Server-side validation of all fields
    const rawAction = String(parsed.recommendedAction || 'STOP').toUpperCase() as GeminiVisionAction;
    const action: GeminiVisionAction = VALID_ACTIONS.has(rawAction) ? rawAction : 'STOP';

    // Enforce speed limits (0 to 255, default 130)
    let speed = typeof parsed.speed === 'number' && !isNaN(parsed.speed) ? Math.round(parsed.speed) : 130;
    speed = Math.max(0, Math.min(255, speed));

    // Enforce duration limits (strictly 0 to 1000 ms!)
    let durationMs = typeof parsed.durationMs === 'number' && !isNaN(parsed.durationMs) ? Math.round(parsed.durationMs) : 500;
    durationMs = Math.max(0, Math.min(1000, durationMs));

    // Confidence
    let confidence = typeof parsed.confidence === 'number' && !isNaN(parsed.confidence) ? parsed.confidence : 0.7;
    confidence = Math.max(0, Math.min(1, confidence));

    // Validate Arm Action if present
    let armAction: { joint: ArmJoint; angle: number } | undefined = undefined;
    if (action === 'ARM_ACTION' && parsed.armAction && typeof parsed.armAction === 'object') {
      const rawJoint = String((parsed.armAction as Record<string, unknown>).joint || '').toUpperCase() as ArmJoint;
      const rawAngle = Number((parsed.armAction as Record<string, unknown>).angle);
      if (VALID_JOINTS.has(rawJoint) && !isNaN(rawAngle)) {
        armAction = {
          joint: rawJoint,
          angle: Math.max(0, Math.min(180, Math.round(rawAngle))),
        };
      } else {
        // Fallback to STOP if arm action parameters are invalid
        return NextResponse.json(
          { ok: false, error: 'Invalid armAction parameters provided by vision analysis' },
          { status: 400 }
        );
      }
    }

    const recommendation: GeminiVisionRecommendation = {
      sceneSummary: String(parsed.sceneSummary || 'Scene inspected by mobile camera.').slice(0, 500),
      detectedObjects: Array.isArray(parsed.detectedObjects)
        ? parsed.detectedObjects.map((o) => String(o).slice(0, 50)).slice(0, 15)
        : [],
      hazards: Array.isArray(parsed.hazards)
        ? parsed.hazards.map((h) => String(h).slice(0, 80)).slice(0, 10)
        : [],
      recommendedAction: action,
      armAction,
      speed,
      durationMs,
      confidence,
      requiresApproval: true, // Always true: Operator must approve!
      reason: String(parsed.reason || 'Evaluation completed. Operator verification required.').slice(0, 600),
    };

    return NextResponse.json({
      ok: true,
      recommendation,
      modelUsed: model,
      source: 'gemini-vision',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
