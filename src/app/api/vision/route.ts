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
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
1. A single 2D camera image CANNOT reliably establish exact physical distance. Mark distanceEstimate as "unknown" unless supported by calibrated sensing.
2. If there are people, pets, stairs, steep drop-offs, cliffs, reflective glass, tight doorways, or fragile obstacles anywhere near the rover's path, you MUST recommend "stop" or "no_action".
3. If the camera frame is blurry, too dark, overexposed, ambiguous, or pointed directly at an obstacle within immediate range, you MUST recommend "stop".
4. Movement duration (durationMs) must NEVER exceed 1000 ms. All movements must be conservative incremental exploratory steps.
5. speedPercent must be between 20% and 65% (conservative crawl or cruise). Never recommend high speeds.
6. Arm actions must specify valid joint ("BASE", "SHOULDER", "ELBOW", "GRIPPER") and angle integer between 0 and 180. If no arm motion is needed, set armAction to null.
7. You must NEVER output raw Arduino C/C++ code, shell scripts, URLs, or arbitrary serial commands.
8. Output MUST strictly conform to the JSON schema below.

Required JSON Structure:
{
  "sceneSummary": "Concise 1-2 sentence description of terrain, ground surface, lighting, and immediate foreground",
  "detectedObjects": [
    {
      "label": "chair",
      "direction": "front",
      "distanceEstimate": "unknown",
      "confidence": 0.91
    }
  ],
  "hazards": ["Possible obstacle ahead"],
  "recommendedAction": "stop",
  "movement": {
    "direction": "stop",
    "speedPercent": 0,
    "durationMs": 0
  },
  "armAction": null,
  "requiresApproval": true,
  "reason": "The obstacle distance has not been verified"
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

    // Server-side validation of recommendedAction
    const rawActionStr = String(parsed.recommendedAction || 'stop').toLowerCase().trim();
    const normalizedActionMap: Record<string, string> = {
      stop: 'stop',
      s: 'stop',
      forward: 'forward',
      f: 'forward',
      backward: 'backward',
      b: 'backward',
      left: 'left',
      l: 'left',
      right: 'right',
      r: 'right',
      arm_action: 'arm_action',
      arm: 'arm_action',
      no_action: 'no_action',
    };
    const validRecommendedAction = normalizedActionMap[rawActionStr] || 'stop';

    // Parse & validate movement object
    const rawMovement = (parsed.movement && typeof parsed.movement === 'object')
      ? (parsed.movement as Record<string, unknown>)
      : {};
    const moveDirStr = String(rawMovement.direction || validRecommendedAction).toLowerCase();
    const validDirections = new Set(['stop', 'forward', 'backward', 'left', 'right']);
    const moveDir = validDirections.has(moveDirStr)
      ? (moveDirStr as 'stop' | 'forward' | 'backward' | 'left' | 'right')
      : 'stop';

    let speedPercent = typeof rawMovement.speedPercent === 'number' && !isNaN(rawMovement.speedPercent)
      ? Math.round(rawMovement.speedPercent)
      : (typeof parsed.speed === 'number' ? Math.round((parsed.speed / 255) * 100) : (moveDir === 'stop' ? 0 : 50));
    speedPercent = Math.max(0, Math.min(100, speedPercent));

    let durationMs = typeof rawMovement.durationMs === 'number' && !isNaN(rawMovement.durationMs)
      ? Math.round(rawMovement.durationMs)
      : (typeof parsed.durationMs === 'number' ? Math.round(parsed.durationMs) : (moveDir === 'stop' ? 0 : 500));
    durationMs = Math.max(0, Math.min(1000, durationMs)); // Strictly <= 1000ms

    // Convert speedPercent to PWM (0-255)
    const pwmSpeed = Math.round((speedPercent / 100) * 255);

    // Parse & validate detectedObjects
    const detectedObjects = Array.isArray(parsed.detectedObjects)
      ? parsed.detectedObjects.map((item: unknown) => {
          if (typeof item === 'object' && item !== null) {
            const obj = item as Record<string, unknown>;
            const dir = String(obj.direction || 'front').toLowerCase();
            const validDirs = ['front', 'left', 'right', 'rear', 'unknown'];
            return {
              label: String(obj.label || 'object').slice(0, 50),
              direction: (validDirs.includes(dir) ? dir : 'unknown') as 'front' | 'left' | 'right' | 'rear' | 'unknown',
              distanceEstimate: String(obj.distanceEstimate || 'unknown').slice(0, 30),
              confidence: typeof obj.confidence === 'number' && !isNaN(obj.confidence)
                ? Math.max(0, Math.min(1, obj.confidence))
                : 0.8,
            };
          }
          return {
            label: String(item).slice(0, 50),
            direction: 'front' as const,
            distanceEstimate: 'unknown',
            confidence: 0.8,
          };
        }).slice(0, 15)
      : [];

    // Parse & validate hazards
    const hazards = Array.isArray(parsed.hazards)
      ? parsed.hazards.map((h) => String(h).slice(0, 100)).slice(0, 10)
      : [];

    // Validate Arm Action if present
    let armAction: { joint: ArmJoint; angle: number } | null = null;
    if (parsed.armAction && typeof parsed.armAction === 'object') {
      const rawJoint = String((parsed.armAction as Record<string, unknown>).joint || '').toUpperCase() as ArmJoint;
      const rawAngle = Number((parsed.armAction as Record<string, unknown>).angle);
      if (VALID_JOINTS.has(rawJoint) && !isNaN(rawAngle)) {
        armAction = {
          joint: rawJoint,
          angle: Math.max(0, Math.min(180, Math.round(rawAngle))),
        };
      }
    }

    const recommendation: GeminiVisionRecommendation = {
      sceneSummary: String(parsed.sceneSummary || 'Scene inspected by mobile camera.').slice(0, 500),
      detectedObjects,
      hazards,
      recommendedAction: validRecommendedAction,
      movement: {
        direction: moveDir,
        speedPercent,
        durationMs,
      },
      armAction,
      speed: pwmSpeed,
      durationMs,
      confidence: typeof parsed.confidence === 'number' && !isNaN(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.85,
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
