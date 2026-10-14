import { NextRequest, NextResponse } from 'next/server';
import { parseLocalCommand } from '@/lib/ai-command-parser';

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // First, check if prompt matches high-priority safety keywords (Emergency Stop, Stop)
    const localCheck = parseLocalCommand(prompt);
    if (localCheck.action?.type === 'ESTOP' || localCheck.action?.type === 'STOP') {
      return NextResponse.json(localCheck);
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // If Gemini API Key is configured, use Google Gemini
    if (geminiKey) {
      try {
        const systemPrompt = `You are the NEX-ROVER robotics controller assistant. 
Translate the user natural language prompt into a SINGLE validated JSON command object.
Only return valid JSON in this exact structure:
{
  "action": {
    "type": "DRIVE" | "SPEED" | "ARM" | "ARM_POSE" | "STOP" | "ESTOP" | "STATUS_QUERY",
    "command": "F" | "B" | "L" | "R" | "S" (only if type is DRIVE),
    "durationMs": number in milliseconds (optional, if time specified),
    "value": number between 0 and 255 (only if type is SPEED),
    "joint": "BASE" | "SHOULDER" | "ELBOW" | "GRIPPER" (only if type is ARM),
    "angle": number between 0 and 180 (only if type is ARM),
    "name": "park" | "reach" | "grab" | "wave" (only if type is ARM_POSE)
  },
  "replyText": "short concise friendly voice-style confirmation (under 15 words)"
}
CRITICAL SAFETY RULE: Never invent arbitrary commands or code. If the user request is ambiguous, return "action": null.`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: systemPrompt },
                    { text: `User command: "${prompt}"` },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1,
              },
            }),
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const candidateText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) {
            const parsed = JSON.parse(candidateText);
            // Sanitize and return
            return NextResponse.json({
              action: parsed.action || null,
              replyText: parsed.replyText || 'Command processed.',
              confidence: 0.95,
              source: 'gemini',
            });
          }
        }
      } catch (err) {
        console.warn('Gemini proxy error, falling back to local parser:', err);
      }
    }

    // If OpenAI Key is configured
    if (openaiKey) {
      try {
        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are the NEX-ROVER controller. Return JSON with {"action": {...}, "replyText": "..."}. Actions: DRIVE (F/B/L/R/S), SPEED (0-255), ARM (BASE/SHOULDER/ELBOW/GRIPPER, 0-180), ARM_POSE (park/reach/grab/wave), STOP, ESTOP. Do not output anything outside this schema.',
              },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
          }),
        });

        if (openaiRes.ok) {
          const openaiData = await openaiRes.json();
          const parsed = JSON.parse(openaiData.choices[0].message.content);
          return NextResponse.json({
            action: parsed.action || null,
            replyText: parsed.replyText || 'Command processed.',
            confidence: 0.95,
            source: 'openai',
          });
        }
      } catch (err) {
        console.warn('OpenAI proxy error, falling back to local parser:', err);
      }
    }

    // Deterministic offline parser fallback
    const localResult = parseLocalCommand(prompt);
    return NextResponse.json({ ...localResult, source: 'local-deterministic' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
